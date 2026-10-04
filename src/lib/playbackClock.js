/**
 * A tiny store for the playback snapshot (what every signal and detector
 * shows at the playhead). The player writes it; the plan's playback layer
 * reads it with useSyncExternalStore, so the playhead moving redraws that
 * layer alone, not the app or the whole plan.
 */
export function createPlaybackStore() {
  let value = null;
  const listeners = new Set();
  return {
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
  };
}
