import { describe, test, expect } from 'vitest';
import { designFile, parseDesignFile, detectorCsv } from '../src/lib/exports.js';
import { createTemplate } from '../src/lib/model.js';
import { parseTable } from '../src/lib/gtss.js';

describe('design file', () => {
  test('round-trips a design', () => {
    const design = createTemplate('five');
    design.legs[0].freeRight = { lanes: 1, ped: 'P', receiving: 'added', size: 'compact' };
    const text = designFile(design, new Date('2026-09-30T00:00:00Z'));
    expect(JSON.parse(text)).toMatchObject({ format: 'intersection-mix', version: 1 });
    const { notes, ...rest } = design;
    expect(parseDesignFile(text)).toEqual({ ...rest, notes: [] });
  });

  test('refuses other files with a reason', () => {
    expect(() => parseDesignFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseDesignFile('{"format":"streetmix","legs":[]}')).toThrow(/streetmix/);
    expect(() => parseDesignFile('{"hello":1}')).toThrow();
  });
});

describe('detector list', () => {
  test('one row per detector, in channel order, with lane and phase resolved', () => {
    const design = createTemplate('four');
    const rows = parseTable(detectorCsv(design));
    const count = design.legs.reduce((n, leg) => n + leg.detectors.length, 0);
    expect(rows).toHaveLength(count);
    expect(rows.map((r) => Number(r.channel))).toEqual([...rows.map((r) => Number(r.channel))].sort((a, b) => a - b));
    const first = rows[0];
    expect(first.phase).not.toBe('');
    expect(Number(first.lane)).toBeGreaterThan(0);
    expect(first.direction).toMatch(/B$/);
  });
});
