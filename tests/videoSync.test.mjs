import { describe, test, expect } from 'vitest';
import { startFromFilename, formatStart, parseStart, syncStep, MAX_RATE } from '../src/lib/videoSync.js';

const at = (h, m, s, ms = 0) => new Date(2026, 8, 17, h, m, s, ms).getTime();

describe('start time from a file name', () => {
  test('common camera and recorder namings', () => {
    expect(startFromFilename('CAM1_20260917_080000.mp4')).toBe(at(8, 0, 0));
    expect(startFromFilename('20260917-080005.5.mov')).toBe(at(8, 0, 5, 500));
    expect(startFromFilename('Main & Oak 2026-09-17 08.00.30.mp4')).toBe(at(8, 0, 30));
    expect(startFromFilename('2026-09-17T08-15-00.webm')).toBe(at(8, 15, 0));
    expect(startFromFilename('TRAF_00001_2026_09_17_0800.mp4')).toBe(at(8, 0, 0));
  });

  test('nothing date-like gives null', () => {
    expect(startFromFilename('intersection.mp4')).toBeNull();
    expect(startFromFilename('clip_20261399_250000.mp4')).toBeNull();
  });

  test('the start box reads what it writes', () => {
    const t = at(8, 0, 19, 800);
    expect(formatStart(t)).toBe('9/17/2026 08:00:19.8');
    expect(parseStart(formatStart(t))).toBe(t);
    expect(parseStart('soon')).toBeNull();
  });
});

describe('following the data clock', () => {
  const startMs = at(8, 0, 0);
  const video = (time, paused = true, duration = 600) => ({ time, paused, duration });
  const clock = (sec, playing, speed = 1) => ({ t: startMs + sec * 1000, playing, speed });

  test('playing at 1x: play at rate 1, leave small drift alone, seek big drift', () => {
    const a = syncStep({ clock: clock(10, true), startMs, video: video(10.1) });
    expect(a).toMatchObject({ play: true, rate: 1, seekTo: null, outside: null });
    expect(syncStep({ clock: clock(10, true), startMs, video: video(12, false) }).seekTo).toBe(10);
  });

  test('at 8x the drift allowed grows with the speed', () => {
    const a = syncStep({ clock: clock(100, true, 8), startMs, video: video(99.5, false) });
    expect(a.rate).toBe(8);
    expect(a.seekTo).toBeNull();
    expect(syncStep({ clock: clock(100, true, 8), startMs, video: video(97, false) }).seekTo).toBe(100);
  });

  test('above 16x the video holds still and is stepped a few times a second', () => {
    const speed = MAX_RATE * 2;
    const a = syncStep({ clock: clock(50, true, speed), startMs, video: video(40, false), now: 1000, lastStep: 950 });
    expect(a).toMatchObject({ pause: true, seekTo: null, rate: null });
    expect(syncStep({ clock: clock(50, true, speed), startMs, video: video(40, true), now: 1300, lastStep: 950 }).seekTo).toBe(50);
  });

  test('paused: hold the frame at the playhead', () => {
    const a = syncStep({ clock: clock(42, false), startMs, video: video(30, false) });
    expect(a).toMatchObject({ pause: true, seekTo: 42 });
  });

  test('outside the video: before or after, parked at its edge', () => {
    expect(syncStep({ clock: clock(-5, true), startMs, video: video(3) })).toMatchObject({ outside: 'before', seekTo: 0 });
    expect(syncStep({ clock: clock(700, true), startMs, video: video(600) })).toMatchObject({ outside: 'after', seekTo: null });
  });
});
