# Swapping Command 57 to the console

The Command 57 Lively wallpaper on apextower moves from the old wall page (`/command-57.html`, `ap3x-kiosk-displays`) to the AP3X Console (`/console/index.html?layout=command-57`). The old wall stays installed and served, and the new Lively package falls back to it on its own.

## 1. Release the console

On rackmain1, after the branch is merged:

```bash
console-release          # builds main, runs the tests, shows the plan, asks, installs /console/, verifies
```

Keep the printed `UNDO.sh` line.

## 2. Compare on apextower before switching

Open both in a browser on apextower, side by side or one after the other:

- Old wall: `http://192.168.4.115:3098/command-57.html`
- Console: `http://192.168.4.115:3098/console/index.html?layout=command-57`

Check:

- [ ] Every panel shows live data (no `UNAVAILABLE` or `NO FEED` chips that the old wall doesn't also show).
- [ ] Press **S** (or the dock's SOURCES) on the console: every feed is `LIVE` with a recent fetch. `printers` is optional.
- [ ] Bank, receipts, and portfolio amounts match the old wall to the dollar.
- [ ] The ticker shows the same lines. TONIGHT/TODAY and FINISHING items come first, marked ◆.
- [ ] **P** blurs the amounts, and **N** switches night mode. Night mode is also set on the old wall, because both use rackmain1's shared night mode.
- [ ] **1 / 2 / 3 / 0** widen OPS / BUSINESS / MARKETS and go back to balanced. **B F K L U** open the drawer pages.
- [ ] The music tile plays (click once if the browser blocks autoplay). Space plays or pauses it.

## 3. Switch Lively

1. In Lively, **Add wallpaper** and choose `command-57-console.zip`. To build the zip yourself, zip the *contents* of `lively/command-57-console/`, so that `LivelyInfo.json` sits at the root of the zip.
2. Set it on the 57" display and open its **Customise** panel:

| Setting | Value |
| --- | --- |
| Wall | AP3X Console |
| Console URL | `http://192.168.4.115:3098/console/index.html` |
| Old wall URL | `http://192.168.4.115:3098/command-57.html` |
| Motion / Starting layout / Screen / Privacy | as before |

3. Leave the old **AP3X Command 57** wallpaper in the Lively library. Don't delete it.

### The automatic fallback

After the console's first refresh, it tells the Lively shell it is up.

If that doesn't happen within 90 seconds, the shell shows the old wall instead. This covers a broken release, a 404, or rackmain1 serving an old build without the console. The shell then retries the console in a hidden frame every 15 minutes, and the console takes the screen back as soon as it answers.

Changing any setting starts over with the console.

## 4. Rolling back

Use whichever is quickest:

- **Lively setting:** set **Wall** to *Old Command 57 wall*. It takes effect at once, and nothing on rackmain1 changes.
- **Lively wallpaper:** switch back to the old *AP3X Command 57* wallpaper.
- **Console release:** run the `UNDO.sh` that `console-release` printed. The shell then keeps the screen on the old wall if the restored build is the broken one.

## 5. After a week

If nothing needed the old wall:

- [ ] Remove the old *AP3X Command 57* wallpaper from Lively.
- [ ] Keep `command-57.html` served on rackmain1. It is the fallback the console's Lively shell uses.

## Shared with the old wall

The console and the old wall are served from the same origin, so they share this PC's browser storage:

- **Receipt and review history** (`c57-biz-days`): one snapshot per day, kept for 120 days. It feeds TRACKED ON THIS WALL in the cash flow detail. History the old wall built up carries over, and both add to it while both run.
- **Portfolio 24-hour trend** (`c57-equity`): carries over the same way.
- **Night mode**: the shared rackmain1 schedule.

## Known differences from the old wall

- **Extra panels:** the console adds LAB · PRINTERS & LASER and CONSOLE FEEDS.
- **Watchlist sparklines:** these start fresh. The console keeps its own quote history while it runs.
