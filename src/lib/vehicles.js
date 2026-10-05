/**
 * Vehicles from detector actuations.
 *
 * High-resolution data says only when each detector was covered. That is
 * enough to follow a vehicle down an approach: it crosses the advance
 * detector, then the stop bar detector, and the time between them says how
 * fast it was going. Between detectors nothing is logged, so the vehicle is
 * carried along at the speed those two actuations imply; while a detector
 * is covered the vehicle sits on it, which is what a queue looks like.
 *
 * Everything between detectors is an approximation, and a vehicle that
 * never crosses a detector is never seen at all.
 *
 * Distances are feet upstream of the stop bar, like a detector's setback.
 * Framework free.
 */

const MPH = 1.467; // ft/s per mph
const LEAD_IN = 5; // seconds a vehicle is shown upstream before its first actuation
const CLEAR = 90; // feet past the stop bar a vehicle is followed before it is dropped
export const MAX_WAIT = 180000; // ms: longer between two detectors and it is a different vehicle
/** A vehicle sitting on a detector for longer than this many times its crossing time is stopped. */
const STOPPED = 2.5;

/** Where each detector channel sits on its approach. */
export function detectorPlaces(design, geom) {
  const places = [];
  for (const g of geom.legs) {
    if (!g.cs.inbound.length) continue;
    for (const item of g.detectors) {
      const channel = String(item.det.channel || '');
      if (!channel || item.det.purpose === 'count') continue;
      const near = Math.max(0, Number(item.det.setback) || 0);
      const far = near + Math.max(1, Number(item.det.length) || 1);
      const lane = item.det.laneId
        ? g.cs.inbound.find((l) => l.lane.id === item.det.laneId)
        : null;
      places.push({
        channel,
        legId: g.id,
        laneId: lane ? lane.lane.id : null, // null: it spans the approach
        lanes: lane ? [lane.lane.id] : g.cs.inbound.map((l) => l.lane.id),
        near,
        far,
      });
    }
  }
  return places;
}

/** Free-flow speed on an approach, ft/s. */
function legSpeed(leg) {
  return Math.max(15, Math.min(60, Number(leg.speed) || 30)) * MPH;
}

/** Every on/off pair for a channel in the timeline. */
function actuations(channel) {
  const out = [];
  if (!channel) return out;
  for (let i = 0; i < channel.t.length; i += 1) {
    if (channel.s[i] !== 'on') continue;
    const end = channel.s[i + 1] === 'off' ? channel.t[i + 1] : channel.t[i] + 1000;
    out.push({ on: channel.t[i], off: Math.max(end, channel.t[i] + 100) });
  }
  return out;
}

/**
 * Follows vehicles down each approach: every actuation either continues a
 * vehicle already on its way (the same lane, a detector it has not passed
 * yet, and a travel time it could have made) or starts a new one. Vehicles
 * in a lane keep their order, so the oldest waiting one is matched first.
 *
 * Returns tracks sorted by when each appears:
 * [{ id, legId, laneId, speed, hits: [{ on, off, near, far }], from, to }].
 */
export function buildTracks(timeline, design, geom) {
  const places = detectorPlaces(design, geom);
  const tracks = [];
  let serial = 0;

  for (const g of geom.legs) {
    const leg = g.leg;
    const onLeg = places.filter((p) => p.legId === g.id);
    if (!onLeg.length) continue;
    const speed = legSpeed(leg);
    const events = [];
    for (const place of onLeg) {
      for (const hit of actuations(timeline.detectors[place.channel])) events.push({ ...hit, place });
    }
    events.sort((a, b) => a.on - b.on || a.place.far - b.place.far);

    const open = new Map(); // laneId -> tracks still coming, oldest first
    const lanes = g.cs.inbound.map((l) => l.lane.id);
    lanes.forEach((id) => open.set(id, []));
    const freeAt = new Map(lanes.map((id) => [id, -Infinity])); // when each lane last took a vehicle

    for (const event of events) {
      const { place } = event;
      let joined = null;
      let lane = null;
      for (const laneId of place.lanes) {
        const queue = open.get(laneId) || [];
        const candidate = queue.find((track) => {
          const last = track.hits[track.hits.length - 1];
          if (last.near <= place.far) return false; // it has passed this detector already
          const dt = event.on - last.off;
          if (dt <= 0 || dt > MAX_WAIT) return false;
          return ((last.near - place.far) / (dt / 1000)) <= speed * 1.3; // it cannot have got here faster
        });
        if (candidate && (!joined || candidate.hits[0].on < joined.hits[0].on)) {
          joined = candidate;
          lane = laneId;
        }
      }
      if (joined) {
        joined.hits.push({ on: event.on, off: event.off, near: place.near, far: place.far });
        if (place.near <= 0.5) {
          // It has reached the stop bar: nothing more will be logged for it.
          const queue = open.get(lane);
          queue.splice(queue.indexOf(joined), 1);
        }
        continue;
      }
      // A new vehicle. A detector that spans the approach does not say which
      // lane, so it goes in the one that has waited longest for a vehicle.
      const laneId = place.laneId
        || place.lanes.reduce((best, id) => ((freeAt.get(id) ?? -Infinity) < (freeAt.get(best) ?? -Infinity) ? id : best), place.lanes[0]);
      freeAt.set(laneId, event.on);
      serial += 1;
      const track = {
        id: `v${serial}`,
        legId: g.id,
        laneId,
        speed,
        hits: [{ on: event.on, off: event.off, near: place.near, far: place.far }],
      };
      tracks.push(track);
      if (place.near > 0.5) open.get(laneId).push(track);
    }
  }

  for (const track of tracks) {
    const first = track.hits[0];
    const last = track.hits[track.hits.length - 1];
    track.from = first.on - LEAD_IN * 1000;
    track.to = last.off + ((last.near + CLEAR) / track.speed) * 1000;
  }
  tracks.sort((a, b) => a.from - b.from);
  const span = Math.max(0, ...tracks.map((t) => t.to - t.from));
  return { tracks, span };
}

/** Where one vehicle is at time t: feet upstream of the stop bar, or null. */
export function trackAt(track, t) {
  if (t < track.from || t > track.to) return null;
  const { hits, speed } = track;
  const first = hits[0];
  if (t <= first.on) return { dist: first.far + ((first.on - t) / 1000) * speed, stopped: false };
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    if (t <= hit.off) {
      // On the detector: creeping across it, or held on it while it stays covered.
      const crossing = ((hit.far - hit.near) / speed) * 1000;
      const held = hit.off - hit.on > crossing * STOPPED;
      if (held) return { dist: (hit.far + hit.near) / 2, stopped: true };
      const part = (t - hit.on) / Math.max(1, hit.off - hit.on);
      return { dist: hit.far - (hit.far - hit.near) * part, stopped: false };
    }
    const next = hits[i + 1];
    if (next && t < next.on) {
      // Between two detectors: carried along at the speed they imply.
      const part = (t - hit.off) / Math.max(1, next.on - hit.off);
      return { dist: hit.near - (hit.near - next.far) * part, stopped: false };
    }
  }
  const last = hits[hits.length - 1];
  return { dist: last.near - ((t - last.off) / 1000) * speed, stopped: false };
}

/**
 * Every vehicle at time t. `tracks` is buildTracks() output; `span` is the
 * longest track, so the search can start from the first one that could
 * still be running.
 */
export function vehiclesAt({ tracks, span }, t, limit = 120) {
  const out = [];
  // The first track that starts after t; everything live began before it.
  let lo = 0;
  let hi = tracks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tracks[mid].from <= t) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0 && tracks[i].from >= t - span; i -= 1) {
    const track = tracks[i];
    if (t > track.to) continue;
    const at = trackAt(track, t);
    if (at) out.push({ id: track.id, legId: track.legId, laneId: track.laneId, ...at });
    if (out.length >= limit) break;
  }
  return out;
}
