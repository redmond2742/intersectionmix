/**
 * Getting a corridor's high-resolution data in: many files from many
 * controllers, often a whole folder of them (one file per controller-hour),
 * narrowed to the corridor's controllers and the hours wanted before
 * anything is read, then grouped into one timeline per signal.
 *
 * Framework free.
 */

import { hourFromFilename, parseHiRes, mergeFiles, buildTimeline } from './hires.js';

/** A controller or signal number with leading zeros dropped, so 00001 and 1 match. */
export function controllerKey(id) {
  const text = String(id ?? '').trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

const pathOf = (file) => file.webkitRelativePath || file.name || '';

/**
 * The hours a set of files covers for the corridor's controllers, read from
 * their names alone: [{ start, controllers: Set }], sorted. Files that don't
 * follow the logger's naming are counted in `unnamed`.
 */
export function hoursAvailable(files, controllers) {
  const wanted = new Set([...controllers].map(controllerKey));
  const hours = new Map();
  let unnamed = 0;
  for (const file of files) {
    const info = hourFromFilename(pathOf(file));
    if (!info) {
      if (/\.(csv|txt|dat)$/i.test(pathOf(file))) unnamed += 1;
      continue;
    }
    if (!wanted.has(info.controller)) continue;
    if (!hours.has(info.start)) hours.set(info.start, new Set());
    hours.get(info.start).add(info.controller);
  }
  return {
    hours: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([start, set]) => ({ start, controllers: set })),
    unnamed,
  };
}

/** The first hour every one of the controllers has, or else the one most of them have. */
export function bestHour(hours, controllers) {
  const all = new Set([...controllers].map(controllerKey));
  const full = hours.find((h) => [...all].every((c) => h.controllers.has(c)));
  if (full) return full.start;
  return hours.reduce((best, h) => (!best || h.controllers.size > best.controllers.size ? h : best), null)?.start ?? null;
}

/** The files for the corridor's controllers whose hour starts in [from, to]. */
export function filesInRange(files, controllers, from, to) {
  const wanted = new Set([...controllers].map(controllerKey));
  return files.filter((file) => {
    const info = hourFromFilename(pathOf(file));
    return info && wanted.has(info.controller) && info.start >= from && info.start <= to;
  });
}

/**
 * Parsed files grouped by controller: from each file's own header
 * (Intersection#), or failing that its name. Returns
 * { byController: Map(key -> { timeline, events, files, start, end }), unknown }.
 */
export function timelinesByController(parsed) {
  const groups = new Map();
  let unknown = 0;
  for (const { name, data } of parsed) {
    const fromName = hourFromFilename(name);
    const key = controllerKey(data.meta.intersection || (fromName && fromName.controller) || '');
    if (!key) {
      unknown += 1;
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(data);
  }
  const byController = new Map();
  for (const [key, list] of groups) {
    const merged = mergeFiles(list);
    if (!merged.events.length) continue;
    byController.set(key, {
      timeline: buildTimeline(merged),
      events: merged.events.length,
      files: list.length,
      start: merged.start,
      end: merged.end,
    });
  }
  return { byController, unknown };
}

/** Reads and parses files (and the .csv inside zips) into { name, data } pairs. */
export async function readLogs(files, readZipText) {
  const out = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const inside = await readZipText(await file.arrayBuffer());
      for (const [name, text] of Object.entries(inside)) {
        if (/\.(csv|txt)$/i.test(name)) out.push({ name, data: parseHiRes(text) });
      }
    } else {
      out.push({ name: pathOf(file), data: parseHiRes(await file.text()) });
    }
  }
  return out.filter((x) => x.data.events.length);
}

/** Whether the signals' data overlaps in time: the window all of them cover, or null. */
export function sharedWindow(entries) {
  const list = [...entries];
  if (list.length < 2) return list[0] ? { start: list[0].start, end: list[0].end } : null;
  const start = Math.max(...list.map((e) => e.start));
  const end = Math.min(...list.map((e) => e.end));
  return end > start ? { start, end } : null;
}
