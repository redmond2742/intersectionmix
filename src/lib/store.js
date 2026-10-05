/**
 * Saving designs: browser autosave and share links.
 *
 * Autosave is a cache, so a refresh does not lose work. It is never the
 * source of truth; a GTSS export is. A share link packs the whole design into
 * the URL hash (#d=...), deflated and base64url-encoded, so it needs no
 * server and never reaches one: the hash is not sent with requests.
 *
 * The feed a design was imported from is kept separately, because an agency
 * export can run to megabytes. If it does not fit, the design still saves;
 * the export then contains just this signal, and the UI says so.
 *
 * `storage` is injected so tests can pass a fake that throws.
 */

import { normalizeDesign } from './model.js';

export const DESIGN_KEY = 'intersectionMix:design:v1';
export const FEED_KEY = 'intersectionMix:feed:v1';
export const SHARE_PREFIX = '#d=';
export const SETTINGS_KEY = 'intersectionMix:settings:v1';

/** App settings. Advanced features are off until switched on here. */
export const DEFAULT_SETTINGS = { playback: false, its: false, video: false };

export function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // Safari private browsing throws on access
  }
}

function safeGet(storage, key) {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  if (!storage) return false;
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function saveDesign(design, storage = defaultStorage()) {
  return safeSet(storage, DESIGN_KEY, JSON.stringify(design));
}

export function loadDesign(storage = defaultStorage()) {
  const raw = safeGet(storage, DESIGN_KEY);
  if (!raw) return null;
  try {
    return normalizeDesign(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Saves (or, with null, clears) the imported feed. False when it did not fit. */
export function saveFeed(feed, storage = defaultStorage()) {
  return safeSet(storage, FEED_KEY, feed ? JSON.stringify(feed) : null);
}

export function loadFeed(storage = defaultStorage()) {
  const raw = safeGet(storage, FEED_KEY);
  if (!raw) return null;
  try {
    const feed = JSON.parse(raw);
    return feed && typeof feed === 'object' && feed.files ? feed : null;
  } catch {
    return null;
  }
}

export function loadSettings(storage = defaultStorage()) {
  const raw = safeGet(storage, SETTINGS_KEY);
  try {
    const saved = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = defaultStorage()) {
  return safeSet(storage, SETTINGS_KEY, JSON.stringify(settings));
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** What goes in a link: the design without the import notes, which are about the feed. */
function shareable(design) {
  const { notes, ...rest } = design;
  return rest;
}

/** The hash fragment for a design, e.g. "#d=...". */
export async function encodeShare(design) {
  const json = new TextEncoder().encode(JSON.stringify(shareable(design)));
  const packed = await pipe(json, new CompressionStream('deflate-raw'));
  return SHARE_PREFIX + toBase64Url(packed);
}

/** The design in a hash fragment, or null when there is none or it is damaged. */
export async function decodeShare(hash) {
  const text = String(hash || '');
  if (!text.startsWith(SHARE_PREFIX)) return null;
  try {
    const bytes = fromBase64Url(text.slice(SHARE_PREFIX.length));
    const json = await pipe(bytes, new DecompressionStream('deflate-raw'));
    return normalizeDesign(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}
