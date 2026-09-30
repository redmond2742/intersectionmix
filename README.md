# Intersection Mix

Streetmix for signalized intersections. Build an intersection one approach at a
time, give every movement a phase, put detectors on the lanes, and read or write
the result as [GTSS](https://gtss.dev) (the General Traffic Signal Specification).

Everything runs in the browser. There is no server and no account.

## Features

- **Plan view.** A top-down drawing built from each approach's bearing and
  cross-section. It shows lanes and pavement arrows, stop bars, crosswalks,
  medians, bike lanes, free-right slips, curb returns and detectors.
  - Drag an approach's ⟳ handle to rotate it. Skewed, T and five-leg
    intersections all work.
  - Scroll to zoom and drag to pan.
- **Cross-section strip.** Each approach as Streetmix-style tiles, seen from
  upstream. Drag lanes to reorder them, drag lane types in from the palette, and
  adjust widths with the ± buttons.
- **Phases.** Every movement (U, left, through, right) has a phase.
  - Lefts can be protected, permissive, protected-permissive or flashing yellow
    arrow.
  - "Auto-assign NEMA phases" numbers a design in the standard way.
  - The phase diagrams are laid out as a ring-and-barrier. Click one to
    highlight that phase on the plan.
- **Detectors.** Detectors have a purpose, a lane, a setback, a length, a mode
  and a technology. You can add stop-bar or advance detection per lane.
  Detectors far upstream are drawn compressed behind a break mark.
- **GTSS in and out.**
  - Load an agency zip (or loose `.txt` files) and pick a signal.
  - Export writes the whole feed back with only that signal's rows rewritten.
    Other signals, `basic_timings.txt`, `preempt.txt` and unknown columns pass
    through byte for byte.
  - Switching signals keeps your edits to the previous one.
- **Saving.** Designs autosave in the browser. **Copy link** packs the design
  into the URL fragment. The fragment is never sent to a server.
- **Images.** Export the plan as SVG or PNG.
- **Undo and redo.** ⌘/Ctrl-Z undoes and ⇧⌘Z (or Ctrl-Y) redoes. Delete
  removes the selected lane or detector.

## Conventions

| Topic | Rule |
| --- | --- |
| Bearing | GTSS `compass_bearing` is the heading of arriving traffic. 90 is an eastbound approach, which extends west of the centre. |
| Lanes | Counted from the inside: lane 1 is next to the centre line, as `detectors.txt` counts them. Right-hand traffic. |
| Phases | Phases belong to movements, not lanes. A protected-permissive or FYA left is protected in its own phase and permissive in its approach's through phase. |
| Crosswalks | `pedX` 1 means the phase's crosswalk crosses that phase's own approach. 3 is the leg opposite, 2 is both, and 4–7 are diagonal or all-way. |
| Crosswalk length | A measured or imported length is exported as-is until the lanes change. After that the export uses `LE-<ft>`, computed from the cross-section. |

GTSS does not record lane order, lane widths or receiving lanes. An import
lays lanes out in their usual order (U, L, LT, T, TR, R, inside to outside), at
11 ft. It draws receiving lanes to match the lanes that feed each leg, and lists
every assumption under **Checks**. It does not invent anything. For example, an
approach with no right-turn row gets no right-turn arrow.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest: model, GTSS mapping, geometry, share links
npm run build
```

The stack is React and Vite, written in plain JavaScript.

- Domain logic lives in `src/lib/` and is framework-free:

  | File | Contents |
  | --- | --- |
  | `model.js` | Design model, templates, NEMA auto-assign, checks |
  | `gtssMapping.js` | Import and export |
  | `geometry.js` | Plan-view layout |
  | `store.js` | Autosave and share links |
  | `gtss.js` | CSV handling |
  | `zipReader.js`, `zipWriter.js` | Zip handling, from Traffic Signal Kit |

- Edits run as model operations on immer drafts (`src/useHistory.js`), which
  also provides undo and redo.
