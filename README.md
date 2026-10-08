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
- **Saving.** Designs autosave in the browser. **Export ▸ Copy share link** packs the design
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
  - You can orbit, pan and zoom, and switch between isometric (the
    default) and perspective.
  - Export a PNG, or a glTF binary (`.glb`, in metres) to keep modelling in
    Blender, SketchUp and similar tools.
  - **Conflicts in time** stands the conflict points up in space and time: the
    plan on the ground, seconds going up.
    - Each movement is a tube climbing as it crosses the intersection.
    - Each conflict point appears at the moment each movement reaches it, linked
      red when the two are under 4 s apart.
    - Compare no signals with a default dual-ring signal cycle, and play, scrub
      and orbit through the cycle.
- **Signal playback (advanced).** Off until switched on under ⚙ Settings.
  - Load high-resolution controller data: the Indiana event log, one CSV per
    controller-hour (`9/17/2026 08:00:19.8, 8, 4`), several at once or a `.zip`.
  - Each lane's stop bar and signal face shows green, yellow or red; a
    protected-permissive left flashes yellow on its through green; crosswalks
    show walk and flashing don't walk; detectors light up when occupied,
    matched to the plan by channel.
  - Play at 1×, 2×, 4×, 8×, 16× or 32×, skip ±30 s or to the next change, or
    scrub. A strip under the slider shows two minutes of phases, pedestrian
    signals and detectors around the playhead.
  - Codes used: 1, 8–12 (phase), 21–23 (pedestrian), 61–65 (overlap),
    81/82 (detector), 89/90 (pushbutton), 131 (pattern).
  - The data stays in the tab and is never saved or uploaded.
  - The 3D view follows playback too:
    - the signal lamps show what the data says, with a play/pause bar and a
      **scanner bar** across the top: the whole loaded period as phase bands,
      with preempt and priority marks, to drag through;
    - **vehicles** are rebuilt from the detector actuations. A vehicle crossing
      the advance detector and then the stop bar is carried between the two at
      the speed that implies, and sits still while a detector stays covered,
      so queues build and discharge. Everything between detectors is an
      approximation, and a vehicle that never crosses one is never seen.
  - **Preemption and priority.** When a preempt (event codes 101–111) or a
    transit priority request (112–115) is running, its approach lights up, on
    the plan and in 3D. Give each approach its preempt or priority number
    under ITS & equipment, since only the agency knows which is which.
- **ITS & equipment (advanced).** Off until switched on under ⚙ Settings;
  then the Intersection panel gains inputs for:
  - the cabinet (332, 334, 336, P, M, NEMA TS-1/TS-2, ATC, pedestal…) and its
    corner, and the controller;
  - CCTV cameras: corner, height, heading, tilt and field of view (mounted on
    the corner's signal pole, or their own);
  - the detection system (loops, video, radar or mixed); video gives each
    approach a detection camera on its mast arm, and the count and each
    camera's approach and mount can be changed;
  - preemption: infrared, video or cloud / GPS, the approaches covered, and
    each one's preempt or priority number in high-resolution data.

  Everything is drawn on the plan and modelled in 3D on the mast-arm poles.
  Detectors are drawn by technology: loops as 6 ft round loops along their
  length, video as zones, radar as hatched zones, magnetometers as pucks.
  The equipment travels with the design file and share links; GTSS has no
  columns for it.
- **Video playback (advanced).** Off until switched on under ⚙ Settings.
  - Open a local video (nothing is uploaded). It plays in a window that floats
    over the plan, can be dragged, resized and collapsed, and swaps places
    with the plan (⇄); ⧉ pops it out into the browser's picture-in-picture.
  - Give it a start time (read from names like `CAM1_20260917_080000.mp4`
    when it can be, remembered per file), or press **Sync to playhead**; it
    then follows signal playback, playing at the same speed up to 16× and
    stepping frames at 32×. Nudge ±0.1 s or ±1 s to fine-tune.
  - With a CCTV camera set up under ITS & equipment, show the intersection in
    3D from that camera beside the video (or instead of it), lamps following
    playback. **Overlay** lays the 3D view over the video with adjustable
    opacity, with heading, tilt and zoom nudges for lining the camera up.
- **Corridor view (advanced).** Off until switched on under ⚙ Settings; then a
  **Corridor** button opens it.
  - Made from an open GTSS feed: pick a road (every signal with an approach on
    it) or tick signals. They are placed by their latitude and longitude, put
    in order along the road, and joined by the road between them: from the
    approach at each signal that faces the next, along a smooth curve, with
    the lanes carried through. Signals whose approaches don't face each other
    are shown with a dashed line instead.
  - Load every signal's high-resolution data at once: a set of files, or a
    whole folder of logger files (such as `CsvData`), narrowed to the
    corridor's controllers and the hours you pick before anything is read.
    Files are matched to signals by controller number.
  - All the signals replay on one clock, with the scanner bar and transport.
    - **Map:** the corridor from above, each signal live, and the vehicles the
      detectors saw driving between them.
    - **Time-space:** distance along the corridor by time, each signal's
      through phase each way as green, yellow and red bands, and the
      vehicles' paths across them, so a green wave (or the lack of one) shows.
    - **3D:** the whole corridor with signal heads following the data and
      cars driving signal to signal, queueing at reds.
  - Vehicles are followed from signal to signal: one leaving toward the next
    signal is matched to one arriving there, first in first out, if the time
    between could have been driven. One that could have arrived sooner drove
    up and waited in the queue. Everything between detectors is an
    approximation.
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
  | `store.js` | Autosave, share links and settings |
  | `gtss.js` | CSV handling |
  | `exports.js` | Design file and detector list |
  | `conflicts.js` | Conflict points |
  | `cameras.js` | Camera pins for the 3D view |
  | `conflictTime.js` | Conflicts in time: phase schedule, travel times, gaps |
  | `hires.js` | High-resolution data: parsing, timeline, state at a moment |
  | `playbackClock.js` | The playback store: snapshot, clock, controls |
  | `its.js` | ITS equipment data: cabinet, CCTV, detection, preemption |
  | `itsLayout.js` | Where the equipment stands, for the plan and 3D |
  | `videoSync.js` | Video start times and keeping a video in step |
  | `vehicles.js` | Vehicles followed from detector actuations, and queues |
  | `corridor.js` | Corridors: signals placed by location, the links between them |
  | `corridorVehicles.js` | Vehicles followed from signal to signal |
  | `corridorData.js` | Narrowing a folder of logger files, grouping them by controller |
  | `zipReader.js`, `zipWriter.js` | Zip handling, from Traffic Signal Kit |

- The 3D view lives in `src/three/`:

  | File | Contents |
  | --- | --- |
  | `areas.js` | Plan areas for the 3D build: sidewalk minus roadway, raised islands (framework-free) |
  | `buildScene.js` | The three.js scene |
  | `pins.js` | Camera pin markers and cameras |
  | `spaceTime.js` | Conflicts in time, in 3D |
  | `equipment.js` | ITS equipment models |
  | `stage.js` | Shared sky, lights and renderer |
  | `CctvView.jsx` | The view from a CCTV camera, beside the video |
  | `corridorScene.js`, `CorridorScene3D.jsx` | The corridor in 3D |
  | `View3D.jsx` | The viewer and its exports |

- Edits run as model operations on immer drafts (`src/useHistory.js`), which
  also provides undo and redo.
