import { describe, test, expect } from 'vitest';
import { encodeShare, decodeShare, saveDesign, loadDesign, saveFeed, loadFeed } from '../src/lib/store.js';
import { createTemplate } from '../src/lib/model.js';

function memoryStorage({ failOn } = {}) {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failOn && k.includes(failOn)) throw new Error('QuotaExceededError');
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}

describe('share links', () => {
  test('round-trip a design through the URL hash', async () => {
    const design = createTemplate('five');
    const hash = await encodeShare(design);
    expect(hash.startsWith('#d=')).toBe(true);
    expect(hash.slice(3)).not.toMatch(/[+/=]/);
    const { notes, ...rest } = design;
    expect(await decodeShare(hash)).toEqual({ ...rest, notes: [] });
  });

  test('a damaged or foreign hash is null, not an error', async () => {
    expect(await decodeShare('#d=not-really-a-design')).toBeNull();
    expect(await decodeShare('#section-2')).toBeNull();
    expect(await decodeShare('')).toBeNull();
  });
});

describe('autosave', () => {
  test('saves and loads', () => {
    const storage = memoryStorage();
    const design = createTemplate('tee');
    expect(saveDesign(design, storage)).toBe(true);
    expect(loadDesign(storage)).toEqual(design);
  });

  test('tolerates storage that throws or is missing', () => {
    const storage = memoryStorage({ failOn: 'feed' });
    expect(saveFeed({ files: { 'a.txt': 'x' } }, storage)).toBe(false);
    expect(loadFeed(storage)).toBeNull();
    expect(saveDesign(createTemplate(), null)).toBe(false);
    expect(loadDesign(null)).toBeNull();
  });
});
