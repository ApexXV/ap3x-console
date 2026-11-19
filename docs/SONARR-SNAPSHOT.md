# Sonarr snapshot pilot

For scheduled RackMain1 observations, select **Rack Steward** on the Media Pipeline tile or open `/console/index.html?layout=rack-steward`. The report reads `/rack-steward-data/current.json` on the wall’s origin. It shows the check time, source coverage, new or changed issues, the model and generation time for each available explanation, and recoveries from the past 24 hours. Missing or stale source data leaves previously detected issues unconfirmed. After 35 minutes without an updated report the display marks it overdue. Follow-up actions are manual.

In the open Media Pipeline panel, select **Live transfer report** at the top. The scheduled transfer table lists each flagged qBittorrent transfer with its client state, progress and remaining bytes. A matched Sonarr queue row shows the series and queued episodes that lack indexed files. Partial observations, unknown matches, unmatched client transfers and verified zero gaps have distinct labels. The transfer assessment shows Astra's returned text and generation time when available. Its transfer references match the IDs beneath the names.

On Command 57, open **Operations → Media Pipeline → Sonarr snapshot**. Select the dated summary directly to inspect transfers, or use the snapshot button inside Media Pipeline. **Back to Media** returns to the normal media details. On the 1080p display, select the Operations tab first. The dedicated view is `/console/index.html?layout=sonarr-snapshot-pilot`.

The saved summary reads `/sonarr-snapshot-data/current.json` on the wall's existing origin. It shows the source observation date. Opening the panel reads archived data and does not contact Sonarr or qBittorrent. If a valid feed is unavailable, the normal Media Pipeline view still works.

When Rack Steward publishes a Family Guy season 18 explanation, the report shows it beside the season's library and manifest checks. It includes the OpenAI model, generation time, evidence sources and a suggested manual follow-up. Command-57 reads the optional `/sonarr-snapshot-data/s18-explanation.json` from the same origin. The viewer checks the saved observation time, expected episodes, indexed count, library gaps, manifest coverage and citations before displaying the text. Earlier snapshots and observations without a matching explanation continue to show the transfer report. Model requests run in Rack Steward. Both the wall and the dedicated report are read-only.

To supply the feed from the adjacent BBX Rack Steward project on ApexTower, run the following in the Console folder before starting the development server or building a release preview:

```powershell
New-Item -ItemType Directory -Force public/sonarr-snapshot-data | Out-Null
python ../bbx-rack-steward/command-57/build_feed.py --output public/sonarr-snapshot-data/current.json
```

Run the normal Console test and build commands from the README. Serve `dist/` at the origin root for a local preview. The preview feed is Git-ignored. In production the sanitized feed lives under `wall-ui/sonarr-snapshot-data/`, beside the release-managed `wall-ui/console/`. Install the validated feed atomically, check the served JSON against the generated SHA-256, then use the normal [Console release](RELEASE.md). The feed survives Console upgrades and the previous Console can be restored using the release's undo script. Publishing a later snapshot is a separate action.

The feed contains one row per transfer with saved detail, including a pseudonymous row ID, client progress, bytes remaining and the exact queued episode ranges without indexed files. The coverage note accounts for transfers present only in aggregate counts. Previously cleared transfers appear as season checks, outside the queue table. The producer derives the season 18 exception by comparing its manifest episode numbers with its library gaps.
