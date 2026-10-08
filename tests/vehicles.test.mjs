import { describe, test, expect } from 'vitest';
import { buildTracks, vehiclesAt, trackAt, detectorPlaces } from '../src/lib/vehicles.js';
import { buildTimeline, parseHiRes } from '../src/lib/hires.js';
import { computeGeometry } from '../src/lib/geometry.js';
import { createTemplate, addDetector } from '../src/lib/model.js';

/** An approach with an advance detector 300 ft back and a stop bar detector. */
function oneApproach() {
  const design = createTemplate('four');
  design.legs.forEach((leg) => { leg.detectors.length = 0; });
  const leg = design.legs[0];
  leg.speed = 30;
  const lane = leg.inbound[0];
  const stop = addDetector(design, leg, { laneId: lane.id, purpose: 'stop bar' });
  stop.channel = '1';
  stop.setback = 0;
  stop.length = 40;
  const advance = addDetector(design, leg, { laneId: lane.id, purpose: 'advance' });
  advance.channel = '2';
  advance.setback = 300;
  advance.length = 6;
  return { design, leg, lane, geom: computeGeometry(design) };
}

const log = (lines) => buildTimeline(parseHiRes(lines.map(([time, code, param]) => `9/17/2026 ${time}, ${code}, ${param}`).join('\n')));
const at = (hms) => new Date(2026, 8, 17, ...hms.split(':').map(Number).slice(0, 2), Number(hms.split(':')[2])).getTime();

describe('detector places', () => {
  test('each detector is placed on its approach, by setback', () => {
    const { design, geom, lane } = oneApproach();
    const places = detectorPlaces(design, geom);
    expect(places).toHaveLength(2);
    const advance = places.find((p) => p.channel === '2');
    expect(advance).toMatchObject({ laneId: lane.id, near: 300, far: 306 });
  });

  test('a detector that spans the approach covers every lane', () => {
    const { design, geom, leg } = oneApproach();
    leg.detectors[0].laneId = null;
    const place = detectorPlaces(design, computeGeometry({ ...design })).find((p) => p.channel === '1');
    expect(place.laneId).toBeNull();
    expect(place.lanes).toEqual(leg.inbound.map((l) => l.id));
    expect(geom).toBeTruthy();
  });
});

describe('following vehicles', () => {
  const { design, geom } = oneApproach();

  test('advance then stop bar is one vehicle, carried between the two', () => {
    // Crosses the advance loop at :00, reaches the stop bar 7 s later.
    const { tracks } = buildTracks(log([
      ['08:00:00.0', 82, 2], ['08:00:00.3', 81, 2],
      ['08:00:07.0', 82, 1], ['08:00:08.0', 81, 1],
    ]), design, geom);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].hits).toHaveLength(2);
    // Half way between the two actuations it is somewhere between them.
    const half = trackAt(tracks[0], at('08:00:03') + 650);
    expect(half.dist).toBeGreaterThan(40);
    expect(half.dist).toBeLessThan(300);
    expect(half.stopped).toBe(false);
  });

  test('a long actuation is a vehicle stopped on the detector', () => {
    const { tracks } = buildTracks(log([
      ['08:00:07.0', 82, 1], ['08:00:40.0', 81, 1],
    ]), design, geom);
    const held = trackAt(tracks[0], at('08:00:20'));
    expect(held.stopped).toBe(true);
    expect(held.dist).toBe(20); // the middle of a 40 ft stop bar loop
  });

  test('vehicles keep their order in a lane, and two is two', () => {
    const { tracks } = buildTracks(log([
      ['08:00:00.0', 82, 2], ['08:00:00.3', 81, 2],
      ['08:00:02.0', 82, 2], ['08:00:02.3', 81, 2],
      ['08:00:07.0', 82, 1], ['08:00:08.0', 81, 1],
      ['08:00:09.0', 82, 1], ['08:00:10.0', 81, 1],
    ]), design, geom);
    expect(tracks).toHaveLength(2);
    expect(tracks.every((t) => t.hits.length === 2)).toBe(true);
    expect(tracks[0].hits[1].on).toBeLessThan(tracks[1].hits[1].on); // first in, first out
  });

  test('a stop bar actuation on its own is still a vehicle', () => {
    const { tracks } = buildTracks(log([['08:00:07.0', 82, 1], ['08:00:08.0', 81, 1]]), design, geom);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].hits).toHaveLength(1);
  });

  test('an impossible travel time starts a new vehicle instead', () => {
    // The stop bar is hit a tenth of a second after the advance loop 300 ft back.
    const { tracks } = buildTracks(log([
      ['08:00:00.0', 82, 2], ['08:00:00.3', 81, 2],
      ['08:00:00.4', 82, 1], ['08:00:01.0', 81, 1],
    ]), design, geom);
    expect(tracks).toHaveLength(2);
  });

  test('vehiclesAt gives what is on the road, and nothing before or after', () => {
    const data = buildTracks(log([
      ['08:00:00.0', 82, 2], ['08:00:00.3', 81, 2],
      ['08:00:07.0', 82, 1], ['08:00:08.0', 81, 1],
    ]), design, geom);
    expect(vehiclesAt(data, at('08:00:05'))).toHaveLength(1);
    expect(vehiclesAt(data, at('07:59:00'))).toHaveLength(0);
    expect(vehiclesAt(data, at('08:01:00'))).toHaveLength(0);
    const [v] = vehiclesAt(data, at('08:00:05'));
    expect(v.legId).toBe(design.legs[0].id);
    expect(v.laneId).toBe(design.legs[0].inbound[0].id);
  });

  test('a vehicle is shown approaching before its first actuation, and clears after its last', () => {
    const { tracks } = buildTracks(log([['08:00:07.0', 82, 1], ['08:00:08.0', 81, 1]]), design, geom);
    const [track] = tracks;
    expect(trackAt(track, at('08:00:05')).dist).toBeGreaterThan(40); // still coming
    expect(trackAt(track, at('08:00:10')).dist).toBeLessThan(0); // past the stop bar
    expect(trackAt(track, at('08:00:30'))).toBeNull(); // long gone
  });
});

describe('queues', () => {
  test('a vehicle that crosses the advance loop long before the stop bar drives up and waits', () => {
    const design = createTemplate('four');
    design.legs.forEach((leg) => { leg.detectors.length = 0; });
    const leg = design.legs[0];
    leg.speed = 30;
    const lane = leg.inbound[0];
    Object.assign(addDetector(design, leg, { laneId: lane.id, purpose: 'stop bar' }), { channel: '1', setback: 0, length: 40 });
    Object.assign(addDetector(design, leg, { laneId: lane.id, purpose: 'advance' }), { channel: '2', setback: 300, length: 6 });
    const geom = computeGeometry(design);
    // Over the advance loop at :00, but not on the stop bar until a minute later (a red light).
    const lines = [['08:00:00.0', 82, 2], ['08:00:00.3', 81, 2], ['08:01:00.0', 82, 1], ['08:01:02.0', 81, 1]];
    const tl = buildTimeline(parseHiRes(lines.map(([time, code, ch]) => `9/17/2026 ${time}, ${code}, ${ch}`).join('\n')));
    const [track] = buildTracks(tl, design, geom).tracks;
    const t = (s) => new Date(2026, 8, 17, 8, 0, s).getTime();
    const waiting = trackAt(track, t(30));
    expect(waiting.stopped).toBe(true);
    expect(waiting.dist).toBeCloseTo(40, 0); // at the back of the stop bar loop, not crawling half way
    expect(trackAt(track, t(3)).dist).toBeLessThan(300 - 3 * 30); // early on it moves at speed
  });
});
