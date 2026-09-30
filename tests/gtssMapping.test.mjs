import { describe, test, expect } from 'vitest';
import { designFromGtss, gtssFromDesign, listSignals, phaseRows } from '../src/lib/gtssMapping.js';
import { parseTable, readTable, splitCsvLine } from '../src/lib/gtss.js';
import { legTurns, turnsKey, addLane, findLeg, createTemplate } from '../src/lib/model.js';

/** Shaped like a real agency export: signal 1 is edited, signal 2 must survive untouched. */
const FEED = {
  'agency.txt':
    'agency_id,agency_name,agency_url,agency_timezone,agency_email\nEX-CA,Example City,http://x,America/Los_Angeles,a@b.c',
  'signals.txt': 'signal_id,agency_id,latitude,longitude\n1,EX-CA,37.9045,-122.0680\n2,EX-CA,37.9100,-122.0700',
  'approaches.txt': [
    'approach_id,signal_id,street_name,compass_bearing,posted_speed,free_right,district',
    '1-1,1,1st Street,23,30,,north',
    '1-2,1,Main Street,120,30,1-FR-P,north',
    '1-4,1,Main Street,272,30,,north',
    '2-1,2,Oak Avenue,0,25,,south',
    '2-2,2,Oak Avenue,180,25,,south',
  ].join('\n'),
  'phases.txt': [
    'phase,signal_id,movement_type,num_of_lanes,approach_id,PedX,crosswalk_length',
    '1,1,L,1,1-2,0,',
    '2,1,T,3,1-4,1,80',
    '3,1,L,2,1-1,0,',
    '6,1,T,2,1-2,1,119',
    '2,2,T,1,2-1,0,',
    '6,2,T,1,2-2,0,',
  ].join('\n'),
  'detectors.txt': [
    'channel,signal_id,phase,description,purpose,vehicle_type,lane,technology_type,mode,length,stopbar_setback_dist',
    '1,1,1,"Main St, left turn",stop bar,car,1,inductive_loop,presence,40,0',
    '2,1,2,,stop bar,car,2,video,presence,40,0',
    '9,1,0,count station,count,,,radar,pulse,6,400',
    '1,2,2,,stop bar,,1,inductive_loop,presence,40,0',
  ].join('\n'),
  'basic_timings.txt': 'phase,signal_id,min_green,yellow\n2,1,10,4\n2,2,8,3.5',
  'preempt.txt': 'preempt_channel,signalID,type,phase,maxTime\n3,1,EMERGENCY,1,120\n4,2,RAIL,2,60',
};

const lines = (text) => text.trim().split('\n');

describe('csv', () => {
  test('quoted cells keep their commas and quotes', () => {
    expect(splitCsvLine('1,"Main St, left",x')).toEqual(['1', 'Main St, left', 'x']);
    expect(splitCsvLine('"say ""hi""",2')).toEqual(['say "hi"', '2']);
  });
  test('unquoted input reads like a plain split', () => {
    expect(parseTable('a,b\n1, 2\n3,')).toEqual([{ a: '1', b: '2' }, { a: '3', b: '' }]);
  });
});

describe('import', () => {
  test('lists every signal, named from its streets', () => {
    expect(listSignals(FEED).map((s) => [s.id, s.name])).toEqual([
      ['1', 'Main Street & 1st Street'],
      ['2', 'Oak Avenue'],
    ]);
  });

  test('builds legs and lanes from approaches and phases', () => {
    const design = designFromGtss(FEED, '1');
    expect(design.legs.map((l) => l.approachId)).toEqual(['1-1', '1-2', '1-4']);
    const west = design.legs.find((l) => l.approachId === '1-4');
    expect(west.inbound.map((l) => turnsKey(l.turns))).toEqual(['T', 'T', 'T']);
    expect(west.movements.T.phase).toBe('2');
    const main = design.legs.find((l) => l.approachId === '1-2');
    expect(main.inbound.map((l) => turnsKey(l.turns))).toEqual(['L', 'T', 'T']);
    expect(main.movements.L.phase).toBe('1');
    expect(main.freeRight).toEqual({ lanes: 1, ped: 'P' });
    expect(main.extra).toEqual({ district: 'north' });
  });

  test('pedX 1 puts the crosswalk across the phase\'s own leg', () => {
    const design = designFromGtss(FEED, '1');
    const west = design.legs.find((l) => l.approachId === '1-4');
    expect(west.crosswalk).toMatchObject({ enabled: true, pedPhase: '2', length: '80' });
    const side = design.legs.find((l) => l.approachId === '1-1');
    expect(side.crosswalk.enabled).toBe(false);
  });

  test('invents no right turns, and says so', () => {
    const design = designFromGtss(FEED, '1');
    const west = design.legs.find((l) => l.approachId === '1-4');
    expect(legTurns(west)).not.toContain('R');
    expect(design.notes.some((n) => n.includes('no right turn'))).toBe(true);
  });

  test('detectors land on their lane, count stations are kept aside', () => {
    const design = designFromGtss(FEED, '1');
    const main = design.legs.find((l) => l.approachId === '1-2');
    const det = main.detectors.find((d) => d.channel === '1');
    expect(det.description).toBe('Main St, left turn');
    expect(det.laneId).toBe(main.inbound[0].id);
    const west = design.legs.find((l) => l.approachId === '1-4');
    expect(west.detectors[0]).toMatchObject({ channel: '2', technology: 'video', laneId: west.inbound[1].id });
    expect(design.unplacedDetectors.map((r) => r.channel)).toEqual(['9']);
  });
});

describe('export', () => {
  test('other signals, timings and preempts come back byte for byte', () => {
    const design = designFromGtss(FEED, '1');
    const { files } = gtssFromDesign(design, FEED);
    for (const name of ['approaches.txt', 'phases.txt', 'detectors.txt', 'signals.txt']) {
      const others = lines(FEED[name]).filter((line) => /^[^,]*,2,|^2,/.test(line) && !line.includes(',1,'));
      for (const line of others) expect(lines(files[name])).toContain(line);
    }
    expect(files['basic_timings.txt']).toBe(FEED['basic_timings.txt']);
    expect(files['preempt.txt']).toBe(FEED['preempt.txt']);
    expect(files['agency.txt']).toBe(FEED['agency.txt']);
  });

  test('keeps the source header and extra columns', () => {
    const design = designFromGtss(FEED, '1');
    const { files } = gtssFromDesign(design, FEED);
    expect(lines(files['approaches.txt'])[0]).toBe(lines(FEED['approaches.txt'])[0]);
    expect(files['approaches.txt']).toContain('1-2,1,Main Street,120,30,1-FR-P,north');
    const phases = readTable(files['phases.txt']);
    expect(phases.headers.slice(0, 7)).toEqual(lines(FEED['phases.txt'])[0].split(','));
  });

  test('round trip gives back the same design', () => {
    const first = designFromGtss(FEED, '1');
    const { files } = gtssFromDesign(first, FEED);
    const second = designFromGtss(files, '1');
    const shape = (design) => design.legs.map((leg) => ({
      id: leg.approachId,
      bearing: leg.bearing,
      lanes: leg.inbound.map((l) => turnsKey(l.turns)),
      moves: leg.movements,
      cw: [leg.crosswalk.enabled, leg.crosswalk.pedPhase],
      free: leg.freeRight,
      dets: leg.detectors.map((d) => [d.channel, d.phase, d.purpose, d.setback]),
    }));
    expect(shape(second)).toEqual(shape(first));
    expect(second.unplacedDetectors.map((r) => r.channel)).toEqual(['9']);
  });

  test('an edit changes only this signal\'s rows', () => {
    const design = designFromGtss(FEED, '1');
    const west = design.legs.find((l) => l.approachId === '1-4');
    addLane(west, ['T', 'R']);
    const { files } = gtssFromDesign(design, FEED);
    const rows = parseTable(files['phases.txt']).filter((r) => r.signal_id === '1' && r.approach_id === '1-4');
    expect(rows.map((r) => [r.phase, r.movement_type, r.num_of_lanes])).toEqual([
      ['2', 'T', '3'],
      ['2', 'TR', '1'],
    ]);
    expect(rows[0].PedX).toBe('1');
  });

  test('signal only drops the rest of the agency', () => {
    const design = designFromGtss(FEED, '1');
    const { files } = gtssFromDesign(design, FEED, { signalOnly: true });
    expect(parseTable(files['approaches.txt']).every((r) => r.signal_id === '1')).toBe(true);
    expect(lines(files['basic_timings.txt'])).toEqual(['phase,signal_id,min_green,yellow', '2,1,10,4']);
    expect(lines(files['preempt.txt'])).toEqual(['preempt_channel,signalID,type,phase,maxTime', '3,1,EMERGENCY,1,120']);
  });

  test('a new design exports a complete, spec-shaped feed', () => {
    const design = createTemplate('four');
    const { files, warnings } = gtssFromDesign(design);
    expect(Object.keys(files).sort()).toEqual(['agency.txt', 'approaches.txt', 'detectors.txt', 'phases.txt', 'signals.txt']);
    expect(lines(files['phases.txt'])[0]).toBe('phase,approach_id,signal_id,movement_type,num_of_lanes,ped_phase_enabled,is_overlap,pedX,crosswalk_length');
    expect(warnings.some((w) => w.includes('placeholder'))).toBe(true);
    const back = designFromGtss(files, design.signal.id);
    expect(back.legs.map((l) => l.inbound.length)).toEqual(design.legs.map((l) => l.inbound.length));
  });

  test('a crosswalk whose phase has no lanes on the leg or opposite becomes a PED row', () => {
    const design = createTemplate('four');
    const leg = design.legs[2];
    leg.crosswalk.pedPhase = '9';
    const rows = phaseRows(design).filter((r) => r.phase === '9');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ movement_type: 'PED', approach_id: leg.approachId, pedX: '1', num_of_lanes: '0' });
    expect(findLeg(design, leg.id).crosswalk.pedPhase).toBe('9');
  });
});
