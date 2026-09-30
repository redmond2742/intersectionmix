import { describe, test, expect } from 'vitest';
import {
  createTemplate, TEMPLATES, validate, autoAssignNema, addLane, moveLane, turnsKey, emptyDesign,
  makeLeg, autoNumberChannels, addDetector, turnTargets, normalizeDesign, openBearing, usedPhases,
} from '../src/lib/model.js';

describe('templates', () => {
  test.each(TEMPLATES.map((t) => t.id))('%s is valid', (id) => {
    const design = createTemplate(id);
    expect(validate(design)).toEqual([]);
  });
});

describe('NEMA auto-assign', () => {
  test('four-leg: 2/6 main street, 4/8 side street, lefts on the conflicting approach', () => {
    const design = createTemplate('four');
    const [eb, wb, nb, sb] = design.legs;
    expect([eb.movements.T.phase, eb.movements.L.phase]).toEqual(['2', '5']);
    expect([wb.movements.T.phase, wb.movements.L.phase]).toEqual(['6', '1']);
    // 4 is a quarter turn clockwise from 2 (EB -> SB).
    expect(sb.movements.T.phase).toBe('4');
    expect(nb.movements.T.phase).toBe('8');
    expect(eb.movements.L.treatment).toBe('pp');
    expect(eb.crosswalk.pedPhase).toBe('2');
    expect(usedPhases(design)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  test('T: the side street\'s unopposed left is protected in its own phase', () => {
    const design = createTemplate('tee');
    const side = design.legs[2];
    expect(side.movements.L).toEqual({ phase: side.movements.T.phase || side.movements.R.phase, treatment: 'protected' });
    expect(side.movements.R.phase).toBe('8');
  });

  test('a shared left-through lane gets a permissive left', () => {
    const design = emptyDesign();
    design.legs = [
      makeLeg({ approachId: '1', bearing: 0, inbound: [['L', 'T']], outbound: 1 }),
      makeLeg({ approachId: '2', bearing: 180, inbound: [['L', 'T']], outbound: 1 }),
    ];
    autoAssignNema(design);
    expect(design.legs[0].movements.L).toEqual({ phase: '2', treatment: 'permissive' });
  });
});

describe('editing', () => {
  test('lanes are added where they belong and can be moved', () => {
    const leg = makeLeg({ inbound: [['T'], ['T']] });
    addLane(leg, ['L']);
    addLane(leg, ['R']);
    expect(leg.inbound.map((l) => turnsKey(l.turns))).toEqual(['L', 'T', 'T', 'R']);
    moveLane(leg, 3, 0);
    expect(leg.inbound.map((l) => turnsKey(l.turns))).toEqual(['R', 'L', 'T', 'T']);
  });

  test('channels renumber by phase, stop bar first', () => {
    const design = createTemplate('four');
    design.legs[0].detectors.forEach((d) => { d.channel = '50'; });
    autoNumberChannels(design);
    const channels = design.legs.flatMap((l) => l.detectors.map((d) => Number(d.channel)));
    expect(new Set(channels).size).toBe(channels.length);
    expect(Math.min(...channels)).toBe(1);
  });

  test('validate reports duplicate channels and missing phases', () => {
    const design = createTemplate('four');
    const leg = design.legs[0];
    addDetector(design, leg, { channel: design.legs[1].detectors[0].channel, laneId: leg.inbound[0].id });
    leg.movements.T.phase = '';
    const text = validate(design).map((w) => w.text).join('\n');
    expect(text).toMatch(/used by more than one detector/);
    expect(text).toMatch(/through has no phase/);
  });

  test('turn targets follow right-hand geometry', () => {
    const design = createTemplate('four');
    const [eb, wb, nb, sb] = design.legs;
    const t = turnTargets(design, eb);
    expect(t.T).toBe(wb.id); // eastbound through leaves on the east leg (the WB approach)
    expect(t.L).toBe(sb.id); // eastbound left heads north, onto the north leg (the SB approach)
    expect(t.R).toBe(nb.id);
  });

  test('a new leg goes in the widest gap', () => {
    const design = createTemplate('tee');
    expect(openBearing(design)).toBe(180);
  });

  test('normalize rebuilds a design from untrusted JSON', () => {
    const design = createTemplate('five');
    const again = normalizeDesign(JSON.parse(JSON.stringify(design)));
    expect(again).toEqual(design);
    expect(() => normalizeDesign({ nope: 1 })).toThrow();
  });
});
