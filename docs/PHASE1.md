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

## Lab touch screen (LabTouch1)

- [x] Core: paged layouts with a touch tab bar, compact top bar, return-to-home when idle
- [x] Modules: home (clock, weather, printer / machine / network tiles), weather (NWS forecast), lab climate (live outdoor; HVAC, lights, and lab sensor reserved until hardware exists), LabPi1 health, network I/O
- [x] Camera: frames pause on hidden pages; WATCH LIVE opens the go2rtc player full screen
- [x] `lab-touch` layout (800×480): HOME, PRINTERS, CAMERAS, CLIMATE, NETWORK
- [ ] LabPi1 agent and rackmain1 lab-node collector (`ap3x-wall-data-collectors`) feeding `/lab-node-data/current.json`
- [ ] go2rtc on LabPi1 for the printer cameras, relayed by rackmain1's go2rtc as `lab_x1c`, `lab_h2c`, `lab_p2s`, `lab_r1`
- [ ] Router-wide network traffic (the feed's `router` block)
- [ ] Lab temperature / humidity sensor, HVAC, and light controls once hardware is chosen

## Then

- [ ] Layout parity check: screenshots of the console and the current wall side by side at 7680×2160 and 3200×1800
- [ ] Release path: build on rackmain1 and install `dist/` beside the feeds with plan / apply / verify / undo, like `wall-release` (`deploy/rackmain1-release.sh`, `console-release`)
- [ ] Switch Lively to the console layout; keep the old wall as a fallback for a week
- [ ] A layout editor (drag panels, pick modules) on top of the validated layout format
