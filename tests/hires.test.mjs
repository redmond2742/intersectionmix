import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseTime, parseHiRes, mergeFiles, buildTimeline, stateAt, channelAt, changeIndex, nextChange, previousChange,
  movementSignal, overlapLetter, describeLog, GAP_MS, hourFromFilename,
} from '../src/lib/hires.js';
import { createTemplate } from '../src/lib/model.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../src/lib/store.js';

const text = readFileSync(new URL('./fixtures/hires-sample.csv', import.meta.url), 'utf8');
const at = (hms) => parseTime(`9/17/2026 ${hms}`);

describe('parsing', () => {
  const { meta, events } = parseHiRes(text);

  test('the header block is metadata, not events', () => {
    expect(text).toContain('\r\n');
    expect(meta.intersection).toBe('1');
    expect(meta.ip).toBe('172.31.101.1');
    expect(meta.start).toBe(at('08:00:00.0'));
    expect(events.length).toBe(111 - 6);
  });

  test('events keep tenths of a second', () => {
    const yellow = events.find((e) => e.code === 8 && e.param === 4);
    expect(yellow.t).toBe(at('08:00:19.8'));
    expect(yellow.t - at('08:00:19')).toBe(800);
  });

  test('ISO timestamps work too', () => {
    expect(parseTime('2026-09-17 08:00:19.8')).toBe(at('08:00:19.8'));
    expect(parseTime('not a time')).toBeNaN();
  });

  test('hours merge in time order, whatever order they arrive in', () => {
    const late = parseHiRes('9/17/2026 09:00:00.5, 82, 3\n9/17/2026 09:00:01.0, 81, 3\n');
    const log = mergeFiles([late, parseHiRes(text)]);
    expect(log.events.every((e, i) => i === 0 || log.events[i - 1].t <= e.t)).toBe(true);
    expect(log.start).toBe(at('08:00:00.0'));
    expect(log.end).toBe(at('09:00:01.0'));
    expect(log.controllers).toEqual(['1']);
  });
});

describe('timeline', () => {
  const tl = buildTimeline(mergeFiles([parseHiRes(text)]));

  test('phase 4: green before its first logged change, yellow at 08:00:19.8, red after red clearance', () => {
    expect(channelAt(tl.phases['4'], at('08:00:10.0'))).toBe('green'); // inferred from the yellow that follows
    expect(stateAt(tl, at('08:00:19.8')).phases['4']).toBe('yellow');
    expect(stateAt(tl, at('08:00:24.0')).phases['4']).toBe('red');
    expect(stateAt(tl, at('08:02:21.1')).phases['4']).toBe('green');
  });

  test('a phase the log never mentions is unknown', () => {
    expect(stateAt(tl, at('08:00:10.0')).phases['8']).toBeUndefined();
    expect(channelAt(undefined, 0)).toBe('unknown');
  });

  test('detectors are on between 82 and 81', () => {
    expect(stateAt(tl, at('08:00:01.5')).detectors.has('23')).toBe(true);
    expect(stateAt(tl, at('08:00:02.2')).detectors.has('23')).toBe(false);
  });

  test('pedestrian walk, then flashing don’t walk', () => {
    expect(stateAt(tl, at('08:02:22.0')).peds['4']).toBe('walk');
    expect(stateAt(tl, at('08:02:28.5')).peds['4']).toBe('fdw');
  });

  test('the change index moves only when something changes; skipping lands on changes', () => {
    const t = at('08:00:19.8');
    expect(changeIndex(tl, t + 50)).toBe(changeIndex(tl, t));
    expect(changeIndex(tl, t - 1)).toBeLessThan(changeIndex(tl, t));
    expect(nextChange(tl, t)).toBeGreaterThan(t);
    expect(previousChange(tl, t)).toBeLessThan(t);
    expect(tl.changes).toContain(t);
  });

  test('a long silence is a gap in the data', () => {
    const gappy = buildTimeline(mergeFiles([parseHiRes(`9/17/2026 08:00:00.0, 82, 1\n9/17/2026 08:20:00.0, 81, 1\n`)]));
    expect(gappy.gaps).toEqual([{ from: at('08:00:00.0'), to: at('08:20:00.0') }]);
    expect(GAP_MS).toBeLessThan(20 * 60 * 1000);
  });

  test('overlaps by letter', () => {
    expect(overlapLetter(1)).toBe('A');
    const ov = buildTimeline(parseHiRes('9/17/2026 08:00:00.0, 61, 2\n9/17/2026 08:00:05.0, 63, 2\n').events);
    expect(stateAt(ov, at('08:00:01.0')).overlaps.B).toBe('green');
    expect(stateAt(ov, at('08:00:06.0')).overlaps.B).toBe('yellow');
  });
});

describe('movement indications', () => {
  const design = createTemplate('four');
  const leg = design.legs.find((l) => l.movements.L.treatment === 'pp');
  const snap = (phases) => ({ phases, overlaps: {}, peds: {} });

  test('a protected-permissive left: green arrow, then permissive on its through phase', () => {
    expect(leg).toBeTruthy();
    const { L, T } = leg.movements;
    expect(movementSignal(design, leg, 'L', snap({ [L.phase]: 'green', [T.phase]: 'red' }))).toBe('green');
    expect(movementSignal(design, leg, 'L', snap({ [L.phase]: 'red', [T.phase]: 'green' }))).toBe('permissive');
    expect(movementSignal(design, leg, 'L', snap({ [L.phase]: 'red', [T.phase]: 'red' }))).toBe('red');
    expect(movementSignal(design, leg, 'T', snap({ [T.phase]: 'yellow' }))).toBe('yellow');
  });

  test('an overlap movement reads the overlap', () => {
    const d = createTemplate('four');
    const l = d.legs[0];
    l.movements.R.phase = 'A';
    expect(movementSignal(d, l, 'R', { phases: {}, overlaps: { A: 'green' }, peds: {} })).toBe('green');
  });

  test('channels compared with the plan', () => {
    const tl = buildTimeline(parseHiRes(text).events);
    const info = describeLog(tl, design, ['2', '23', '99']);
    expect(info.notOnPlan).toContain('25');
    expect(info.notOnPlan).not.toContain('23');
    expect(info.noData).toEqual(['99']);
  });
});

describe('settings', () => {
  test('round-trip, defaults, and a storage that throws', () => {
    const data = new Map();
    const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings({ playback: true }, storage)).toBe(true);
    expect(loadSettings(storage).playback).toBe(true);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings({ playback: true }, broken)).toBe(false);
  });
});

describe('file names', () => {
  test('controller and hour, so a folder can be narrowed before reading', () => {
    expect(hourFromFilename('TRAF_00001_2026_09_17_0800.csv')).toEqual({ controller: '1', start: at('08:00:00.0') });
    expect(hourFromFilename('CsvData/Ctrl02005/TRAF_02005_2026_09_17_1300.csv').controller).toBe('2005');
    expect(hourFromFilename('notes.csv')).toBeNull();
  });
});
