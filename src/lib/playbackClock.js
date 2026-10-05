/**
 * A tiny store for signal playback, shared by everything that follows it.
 *
 * - The snapshot (what every signal and detector shows at the playhead):
 *   the player writes it; the plan's playback layer, the 3D views and the
 *   video window read it with useSyncExternalStore, so the playhead moving
 *   redraws them alone, not the app or the whole plan.
 * - The clock ({ t, playing, speed, start, end }), published every frame
 *   by the player, for the video to follow and for compact transport bars.
 * - Controls ({ seek, setPlaying, setSpeed }), registered by the player
 *   while data is loaded, so those bars and the video can drive it.
 */
/** Playback speeds offered everywhere. */
export const SPEEDS = [1, 2, 4, 8, 16, 32];

export function createPlaybackStore() {
  let value = null;
  const listeners = new Set();
  const frameListeners = new Set();
  const store = {
    clock: null,
    controls: null,
    timeline: null, // the loaded data, for the scanner bar and for vehicles
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    frame(clock) {
      store.clock = clock;
      frameListeners.forEach((fn) => fn(clock));
    },
    onFrame(fn) {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
  };
  return store;
}
