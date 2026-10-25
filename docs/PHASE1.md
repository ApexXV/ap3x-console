# Phase 1: make Command 57 modular

Goal: the AP3X Console runs Command 57 from layout files and modules, matching today's wall, while `ap3x-kiosk-displays/command-57.html` keeps running untouched until the console replaces it.

## Done

- [x] Core: module and layout types, source polling with retention and staleness, layout validation, console runtime (stage scaling, panels, priority banner, Changes log with merged repeats, detail overlay with tabs and paging)
- [x] Design system: AP3X tokens and chamfered panels in stage-relative `em`
- [x] Layouts: `command-57` (7680×2160, every panel placed; unported ones are placeholders) and `ops-1080`
- [x] Modules: media pipeline (MA001, Plex sessions, *arr queue with stuck ages, YouTube archive, schedule, disk forecast), lab printers, node status, console feed health
- [x] Tests (every module against demo, empty, and garbage input at two stage widths; core behaviour) and CI

## Next: port the remaining panels

Each becomes a module with its existing contract, demo data, detail view, changes, and priority:

- [x] Host (CPU, memory, disks, load, uptime, API latency, containers, nodes) from `/api/status`
- [x] Services from `/api/status` and the ops brief (the service list and aliases are a setting)
- [x] Camera (go2rtc frame refresh on its own 5 s cycle) — later per-printer cameras through LabPi1
- [ ] Local weather, radar map, aircraft, and forecast (Leaflet)
- [x] Threat and ops feed
- [x] FM operations (ClickUp): counts, deadlines, Lists with drill-in, mentions and comms
- [ ] Business: bank, receipts, review queue, cash flow, books health, obligations, latest receipt (summaries from `ucs-layout-v2-data.js`)
- [ ] Finance and markets: portfolio, watchlist, market sentinel, control and external
- [ ] Console chrome: ticker (today/tonight strip), night mode, privacy toggle button, motion setting, music tile

## Then

- [ ] Layout parity check: screenshots of the console and the current wall side by side at 7680×2160 and 3200×1800
- [ ] Release path: build on rackmain1 (or CI artifact) and install `dist/` beside the feeds with plan / apply / verify / undo, like `wall-release`
- [ ] Switch Lively to the console layout; keep the old wall as a fallback for a week
- [ ] A layout editor (drag panels, pick modules) on top of the validated layout format
