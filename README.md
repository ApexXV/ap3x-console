# AP3X Console

A modular display console: **modules** turn JSON data contracts into a compact panel and a drill-down detail view, and **layout files** place module instances on a fixed-size stage that scales to any screen, from a 1080p monitor to a 7680×2160 dual-4K ultrawide. It grew out of AP3X Command 57 (`ApexXV/ap3x-kiosk-displays`), which is being rebuilt on it panel by panel; see [docs/PHASE1.md](docs/PHASE1.md).

```bash
npm install
npm run dev          # http://localhost:5173/?layout=command-57 (demo data on localhost)
npm test             # core and module tests (Vitest + jsdom)
npm run build        # typecheck + production build into dist/
```

URL parameters: `layout=<id>` (a file in `layouts/`), `demo` (force demo data), `runtime=live` (force live feeds on localhost), `privacy=on` (blur names and amounts; hover to peek).

| Path | What it is |
| --- | --- |
| `src/core/` | Module and layout types, source polling and staleness, layout validation, the console runtime (stage, panels, priority banner, Changes log, detail overlay), detail-view building blocks |
| `src/modules/` | Built-in modules, one folder each (manifest, parsing, view, styles) |
| `src/styles/` | Design tokens and shared styles (AP3X Operations palette; sizes in `em` of the layout's stage font size) |
| `layouts/` | Layout files: `command-57` (7680×2160) and `ops-1080` (3200×1800 operations screen) |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [writing a module](docs/MODULES.md), [phase 1 plan](docs/PHASE1.md) |

A build is static files with relative paths: copy `dist/` next to the feeds it reads (on rackmain1, the wall-ui folder) and open `index.html?layout=command-57`.
