# Mission Touch draft for LabTouch1

`mission-touch` is a personal AP3X desk console for LabTouch1's 7-inch, 800×480 touchscreen. It uses the existing AP3X Console on rackmain1. The current `lab-touch` layout remains available as a separate URL.

## Pages

| Tab | What it shows | Source |
| --- | --- | --- |
| TODAY | Work, books, X1C and Photon Mono M7, and machine status; tap a card to open its page; local 25-minute focus control | Existing display feeds |
| WORK | AP3X business obligations and review items | `/business-data/current.json`, `/deductions-data/current.json` |
| BOOKS | AP3X deductions ledger review queue | `/deductions-data/current.json` |
| LAB | X1C and Photon Mono M7 only | `/printers-data/current.json` |
| SYSTEMS | Machine reachability | `/node-status-data/current.json` |
| PROJECTS | Three starting AP3X projects and their next steps; tap to cycle a status stored only in this browser | Layout settings, browser storage |
| MARKETS | Market Sentinel signals and AI capacity | `/api/market/sentinel`, `/ai-capacity-data/current.json` |

The screen returns to TODAY after ten minutes without touch. All feeds are read-only. The focus and project-status controls run only in the browser; they do not change printers, trading systems, or Google Home. Market signals are informational.

The LAB page and TODAY's LAB summary select only the X1C and Photon Mono M7. The live X1C is named `BLACKBOX` in the feed and identified by model `Bambu Lab X1 Carbon`; the demo uses key `x1c`. The Mono M7 uses model `Anycubic Photon Mono M7` or key `m7`. `m7-pro` is a different machine and is excluded. The feed can still contain other devices; this layout does not display or count them.

At draft time, the live feed contains BLACKBOX but no Mono M7. The M7 tile therefore shows that status data is not connected yet. The collector needs an Anycubic M7 adapter before live status can appear.

## Preview and activation

After building the console, preview with demo data at `/console/index.html?layout=mission-touch&demo`. Check all seven tabs at 800×480, then check the live URL `/console/index.html?layout=mission-touch` from LabTouch1's network before selecting it as the kiosk URL. A new layout does not affect the currently selected `lab-touch` URL.

Once reviewed and released using the normal [console release workflow](RELEASE.md), set `KIOSK_URL=http://rackmain1:3098/console/index.html?layout=mission-touch` in `/etc/labtouch/kiosk.env` on LabTouch1 and restart `getty@tty1`. To return to the previous screen, set the URL back to `?layout=lab-touch` and restart `getty@tty1` again.

## Next integrations

The current AP3X work queue covers business obligations and bookkeeping review, not every project. A broader queue needs its own AP3X display feed. The PROJECTS page starts with three items based on current work; editing a status stays on this one kiosk and does not sync to a project system. A sourced research brief or synced planning notes need their own feed. Google Home already handles room controls. Any future button that changes an external service needs a named action and a scoped, authenticated endpoint; the current console has no such endpoint.
