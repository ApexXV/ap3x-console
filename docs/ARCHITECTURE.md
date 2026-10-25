# Architecture

## Pieces

**Data contracts.** Every source is a JSON document with a version marker (`schema_version: "AP3X-PRINTERS-1"`, `contract: "MA001"`) and usually a `generated_at` timestamp. Collectors (today: `ap3x-wall-data-collectors` and the tracker API on rackmain1) produce them; the console only reads them. Contracts carry display fields only: no keys, tokens, addresses, or raw device messages.

**Modules** (`src/modules/<id>/`). A module is a manifest (`ModuleManifest` in `src/core/types.ts`):

- `sources`: the contracts it reads (`id`, `url`, optional `schema`, `stampField`, `maxAgeMs`, `optional`). Modules that read the same feed declare the same id and URL; it is fetched once.
- `model(ctx)`: a pure function from source payloads to a view model. It must tolerate missing, stale, and malformed payloads; tests feed every module garbage.
- `render(body, model, ctx)`: fills the compact panel.
- optional `chip`, `detail` (a full-screen drill-down built from `src/core/detail.ts` blocks), `changes` (events for the Changes timeline), `priority` (a candidate for the top banner, ranked), and `demo` (sample payloads for previews and tests).

**Layouts** (`layouts/*.json`). A fixed stage (`width`, `height`, `fontSize`), regions left to right (`regionColumns`), and in each region a CSS grid of panels: `{ id, module, column?, row?, title?, settings? }`. The same module can appear in several panels with different settings. Small touch screens set `navigation: "pages"` (one region per page, with a tab bar), `chrome: "compact"` (a one-line top bar), and `homeAfterSeconds` (return to the first page after that long without a touch); a module can open a page by dispatching a bubbling `console-page` event whose detail is the region id. `validateLayout` rejects unknown modules, duplicate ids, impossible sizes, and anything that is not a plain CSS grid value.

**The console runtime** (`src/core/console.ts`). Mounts a layout, registers every panel's sources with the `SourceHub`, and refreshes on the layout's interval:

1. `SourceHub.refresh()` fetches every source once, keeps the last good payload for ten minutes if a fetch fails (`retained`), and marks a payload whose own timestamp is older than `maxAgeMs` as `stale`. Optional sources stay `unknown` until they first answer.
2. Each panel: `model` → `render` → `chip`. A module that throws blanks only its own panel.
3. The highest-ranked `priority` across modules takes the banner (feeds 80, lab errors 70, nodes 60, storage 50, …).
4. `changes(previous, next)` events go to the Changes log, which merges repeats (`×3`) and resets at midnight.
5. An open detail view is rebuilt with the new model; its paging and expanded rows live in per-panel `hooks.state`.

**Stage scaling.** The stage is laid out at its design size and scaled with a CSS transform to fit the window. Module styles are in `em` of the stage font size, so a module renders the same on a 1080p stage and a 7680-px one; modules can also read `ctx.stageWidth` to show fewer rows on small stages.

## Where this is headed

Phase 1 (this repository today) is the modular front end with Command 57 rebuilt on it. Later phases add a local agent (collector plugins that push contracts outbound, so no port forwarding), cloud accounts with device pairing, cloud connectors on official APIs, and a module SDK. Keeping modules pure (`model` has no I/O) and contracts versioned is what makes those steps possible without rewriting modules.
