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
- **Conflict points.** A checkbox under the plan marks diverging, merging, crossing and
  pedestrian conflicts for every movement, in the FHWA style. A plain four-leg is the textbook
  32; a T is 9.
- **Export menu.** Formats:
  - GTSS: the whole feed, or this signal only.
  - Plan drawing: PNG or SVG.
  - Phase-diagram sheet: PNG or SVG.
  - Plan with conflict points: PNG.
  - Detector list: CSV.
  - Design file: JSON. It keeps everything GTSS can't hold and reopens
    with **Open…**.
- **3D view.** The **3D view** button opens the design in 3D with three.js,
  which loads only when you click it.
  - The road surface is the plan itself. Sidewalks and porkchop islands are
    raised to curb height.
  - Mast-arm signals hang over every approach lane, and their lamps show a
    chosen phase. The scene also has speed limit signs, street-name blades,
    queued cars and street trees.
  - You can orbit, pan and zoom, and switch between perspective and
    isometric.
  - Export a PNG, or a glTF binary (`.glb`, in metres) to keep modelling in
    Blender, SketchUp and similar tools.
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
  | `exports.js` | Design file and detector list |
  | `conflicts.js` | Conflict points |
  | `cameras.js` | Camera pins for the 3D view |
  | `zipReader.js`, `zipWriter.js` | Zip handling, from Traffic Signal Kit |

- The 3D view lives in `src/three/`:

  | File | Contents |
  | --- | --- |
  | `areas.js` | Plan areas for the 3D build: sidewalk minus roadway, raised islands (framework-free) |
  | `buildScene.js` | The three.js scene |
  | `View3D.jsx` | The viewer and its exports |

- Edits run as model operations on immer drafts (`src/useHistory.js`), which
  also provides undo and redo.
