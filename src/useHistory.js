import { useCallback, useState } from 'react';
import { produce } from 'immer';

const LIMIT = 100;

/**
 * Design state with undo and redo. `update(recipe)` runs a model operation
 * on an immer draft. Updates that share a `key` (one drag, one typed field)
 * collapse into a single undo step.
 */
export function useHistory(initial) {
  const [state, setState] = useState(() => ({ past: [], present: initial(), future: [], lastKey: null }));

  const update = useCallback((recipe, { key = null } = {}) => {
    setState((s) => {
      const next = produce(s.present, recipe);
      if (next === s.present) return s;
      if (key && s.lastKey === key) return { ...s, present: next, future: [] };
      return { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [], lastKey: key };
    });
  }, []);

  /** Swaps in a whole new design (a template, an import); still undoable. */
  const replace = useCallback((design) => {
    setState((s) => ({ past: [...s.past, s.present].slice(-LIMIT), present: design, future: [], lastKey: null }));
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      if (!s.past.length) return s;
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], lastKey: null };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      if (!s.future.length) return s;
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), lastKey: null };
    });
  }, []);

  /** Ends a keyed run, so the next edit with the same key is its own step. */
  const commit = useCallback(() => {
    setState((s) => (s.lastKey ? { ...s, lastKey: null } : s));
  }, []);

  return {
    design: state.present,
    update,
    replace,
    undo,
    redo,
    commit,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
