# Frontend notes for Claude (and whoever drives it)

Read this before touching the UI. `docs/PLAN.md` is the project's memory (status, decisions); this file only says what is safe to change in the look and feel, and what is not. The human working on the frontend does it through Claude, so these notes are written for the agent.

## Ground rules
- One small task at a time. Run `npm run typecheck` and `npm test` before saying a change is done; hand-testing in the browser is the human's job (give numbered steps).
- Keep `docs/PLAN.md` "Current status" honest after each task. Do not put tokens in git remote URLs. Pull before starting, push when asked.
- Never name the product with Arduino, Raspberry Pi or Pico. Keep "Gatehouse" in one constant.

## Safe to change freely (looks and feel)
- **CSS**: `src/style.css` (app shell, palette, file bar, toolbar, readouts), `src/layout/dock.css`, `src/layout/*.css` (per-window styles), `src/buildcard.css`. **The look is Apple-style "liquid glass".** Every surface is translucent glass over a soft colour backdrop: the surface tokens in `tokens.css` are translucent, and `src/glass.css` (imported LAST in `main.ts` so it wins) adds the ambient backdrop (`body::before`), `backdrop-filter` blur, the bright rim and the soft shadow. New UI must follow it: use the surface tokens, never an opaque background; add the new selector to the groups in `glass.css` (floating glass, glass controls, wells). Only `<html>` may have a background colour (one on `<body>` paints over the backdrop). The grid canvas is cleared and drawn translucent (`COLORS` in `grid.ts`), the code editor theme is translucent (`COLOR` in `editorcm.ts`), and dockview groups get their glass in `glass.css` (`--dv-group-view-background-color` is transparent). Fallbacks are built in for browsers without `backdrop-filter` and for `prefers-reduced-transparency`.

**Parts menu:** `src/palette.ts` builds foldable sections from `src/partcategories.ts`. A NEW PART must be added to a category there (the test `partcategories.test.ts` fails otherwise). Folding is pure CSS (`.palette-cat.open` switches the body's `grid-template-rows` between 0fr and 1fr); do not animate `height` by measuring.

**Zoom:** the buttons, keys and "fit" go through `Editor.zoomBy / zoomTo / zoomFit`, which animate with `CameraTween` (camerafit.ts has the maths). Do not set `camera.zoom` directly for a user action: use the tween so it is smooth and gets cancelled by a press or the wheel. Zoom is camera state, never project data, and never an undo step.

**Welcome card:** `src/welcome.ts` shows on an empty grid; its rule is in `welcomemodel.ts`. The wrapper AND the card must keep `pointer-events: none` (only the buttons set it back to `auto`), otherwise the card blocks panning, zooming and selecting on the grid beneath it; it also hides while `html.gh-placing` is set, otherwise a part dropped over it is refused (the drop test is `elementFromPoint === canvas`). Any overlay placed over the grid should follow the same rule. If an example is renamed, update the two lookups in `main.ts`.

**Parts search:** the menu's search box filters through `src/partsearch.ts` (word-start matching over name, id, section name). A new part is found automatically once it has a name and a category. New searchable things (e.g. examples) go through `searchNamed`.

**Movable bars:** the file bar and transport bar are made draggable with `makeDraggable` (`src/draggablebar.ts`); to make another floating bar movable, give it `position: absolute` inside the grid area and call it with a new id. Their positions are per-user UI state (localStorage), not project data. Do not use pointer capture on the bar (it redirects clicks away from the grip).

**Menu size:** the right-hand parts menu is sized from `--gh-menu-scale` (tokens.css). Write new sizes inside it as `calc(Npx * var(--gh-menu-scale))`, never plain px, so the menu keeps scaling as one piece.

**Keyboard:** everything reachable with the mouse in the parts menu must also work with the keyboard (headers are buttons, tiles use a roving tabindex, Enter/Space on a tile calls `Editor.placeAtCentre`). New menu items follow the same pattern; arrow-key maths goes in `palettenav.ts`. A focusable element inside the Circuit panel that is not a native button needs `role="button"` so the grid's Space shortcut (start/pause) leaves it alone. Dock tabs are glass pills styled in `glass.css` with selectors that repeat dockview's own (loaded later, so they win).

**Hover names and tooltips:** just set `title` on a control (and an `aria-label` for icon-only buttons): `src/tooltips.ts` turns every title into the glass bubble, so there is nothing else to do. Use `TipBubble` (`src/tipbubble.ts`) directly only for something that is not a title (like the parts menu tiles, which use the part name). Do not rely on the native tooltip: while a control is hovered its `title` attribute is moved to `data-tip`. Hover animations use the spring easing `cubic-bezier(0.2, 0.9, 0.3, 1.35)` and must be switched off under `prefers-reduced-motion`.

Colours and fonts are design tokens: `src/tokens.css` defines them as `--gh-*` variables on `:root` (imported first in `main.ts`), and every CSS file uses `var(--gh-...)`. Add new colours there, not as literals. Not tokenised yet: spacing, radius and shadow sizes, about 20 one-off colours used only once, and the canvas drawing colours in TS (`grid.ts`, `wireview.ts`, `art/*.ts`, which need one palette module).
- **Dock look**: dockview is themed through `THEME` in `src/layout/dock.ts` plus `dock.css`.
- **Animations**: current-flow dashes (`src/animation.ts`, `wireview.ts`), LED glow, the camera pan in `camerapan.ts`, window/tab transitions. Animation is visual only: it may read simulation results but must never write to the scene, the simulation or any board, and the frame loop must stop when nothing moves (`needsAnimation`), or an idle page burns CPU.
- **Part art**: `src/art/*.ts` are SVG strings in "art units" (`ART_CELL` = 20 units = one grid cell). A part is `cols x rows` cells; leads end exactly on grid points. Restyling a drawing is safe as long as the pin positions in `src/parts.ts` still sit on the same grid points (the pin list is authoritative, the drawing only has to agree). Sprites are rasterised per zoom in `sprites.ts`; a part with state-dependent looks goes through `PartType.variant` (cache key must be unique per look).
- **Feel of interaction**: snap radius for pins (`pinRadius` in `wiring.ts`), the placement ghost (`placing.ts`), hover readouts (`readout.ts`, `devicereadouts.ts`), zoom limits (`camera.ts`), the floating toolbar (`toolbar.ts`). Today these numbers are scattered; gathering the tunable ones (snap radius, animation speeds, ghost opacity, zoom steps) in one small config module is a good first task before big feel changes.

## Change only with care (behaviour, saved data)
- **Pin ids and positions** (`parts.ts`): connectivity comes from pin ids and grid positions, never from drawings. Moving or renaming a pin breaks saved projects. Changing a part's cols/rows or pin x/y shifts every saved placement of it.
- **Touching-pin contacts and junctions** (`contacts.ts`, `junctions.ts`, `wiring.ts`, `Scene.tidyJunctions`): these are rules with tests, not styling. Snapping may change how it feels (what is highlighted, how far the cursor reaches) but not which things end up connected, and wires must still end on grid points.
- **Project format and undo** (`src/project/*`): the file is versioned (`.gth` zip, format v4, migrations in `migrate.ts`). UI-only state (camera, selection, dock layout, which window is open) is NOT part of the circuit and must not create undo steps or the unsaved mark. If a UI change needs a new saved field, that is a format change: bump the version, add a migration and tests, and ask the owner first.
- **Simulation and emulators** (`src/sim`, `src/mcu`): not frontend. Timing comes from CPU cycle counts, never wall-clock timers; rendering speed must never change results.
- **Layout persistence** (`src/layout/persist.ts`): the saved dock layout has a format version; if you change panel ids or structure, bump it so old layouts are dropped cleanly instead of crashing restore.

## How the shell fits together
- `src/main.ts` builds everything and wires it by hand: `Project` (scene + camera), `Simulation`, `GridView` (canvas + render loop), `Editor` (input), then the dock windows (Serial console, Build output, Code editor, File explorer). It is the file to read first.
- **Dock**: `src/layout/dock.ts` (`DockLayout`) over dockview. The **Circuit** panel is ONE dock panel holding the canvas and the Parts menu (a foldable column inside it); it can be moved, tabbed, floated, docked on any side, but never closed (custom tab without a close button, only Float in its menu, delete/backspace blocked, listed always-ticked in the Windows menu). Other windows are described in `src/layout/panels.ts` (`WINDOWS`); each window's content is one long-lived element that panels adopt, so state survives closing. The canvas resizes through a ResizeObserver, so moving or hiding panels must never leave it with a stale size (watch zero-size: background tab).
- **Keyboard**: grid shortcuts (Ctrl+Z, R, Delete ...) live in `Editor`; `isForOtherWindow` makes them ignore keys aimed at other windows and tab strips. New windows with their own inputs must stay out of the grid's way the same way.
- **Windows menu** (`windowsmenu.ts`): stays open after a choice, closes when the mouse leaves, on Escape or on an outside press.
- **Rendering**: `GridView` draws on a canvas in a requestAnimationFrame loop that runs only while something moves; ask for a redraw with `view.requestRender()`. Overlays beside the selection follow the canvas through `layout.api.onDidLayoutChange(view.requestRender)`.

## Things that bite
- A hidden or zero-size canvas must not throw or divide by zero.
- Anything that listens to window-level events must be removed when the panel is hidden or rebuilt (dockview may rebuild a panel on restore and reset).
- Do not make `main.ts` bigger with feature logic: put it in its own module with a DOM-free part that has unit tests (the existing `*rows.ts`, `*model.ts` files show the pattern).
- Narrow screens / phone layout are not done (bottom-sheet fallback is an open item in PLAN.md).
- If the dev server looks half-broken (stale cache), restart with `npx vite --port 5173 --force`.
