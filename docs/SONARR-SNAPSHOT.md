# Sonarr snapshot pilot

Open `/?layout=sonarr-snapshot-pilot` on the local Console preview. The panel and its detail view load one relative file, `./pilot-data/sonarr-snapshot.json`. The header shows when Sonarr was observed. Closing or refreshing the view has no effect on the queue.

To supply the feed from the adjacent BBX Rack Steward project on ApexTower, run the following in the Console folder before starting the development server or building a release preview:

```powershell
New-Item -ItemType Directory -Force public/pilot-data | Out-Null
python ../bbx-rack-steward/command-57/build_feed.py --output public/pilot-data/sonarr-snapshot.json
```

Run the normal Console test and build commands from the README. Serve `dist/` locally after building. The source feed is Git-ignored; the static build copies it into the local preview. The BBX producer also supplies a searchable file-based viewer.

The feed contains one row per transfer with saved detail, including a pseudonymous row ID, client progress, bytes remaining and the exact queued episode ranges without indexed files. The coverage note accounts for transfers present only in aggregate counts. Previously cleared transfers appear as season checks, outside the queue table. The producer derives the season 18 exception by comparing its manifest episode numbers with its library gaps.
