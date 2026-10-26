# Releasing the console on rackmain1

`deploy/rackmain1-release.sh` (alias `console-release`) builds the console from `main` and serves it from rackmain1's wall-ui folder as `/console/`, next to the feeds it reads. Like `wall-release` and `collectors-release` it shows a plan, asks, applies, verifies, and prints an undo command.

```bash
console-release           # build, test, plan, ask, apply, verify
console-release --plan    # build and show the plan only
console-release --yes     # no prompt
```

What it does:

1. Fetches `origin/main` into `~/src/ap3x-console` and continues from that copy of the script.
2. Builds the exact commit in a throwaway folder inside a `node:22-bookworm-slim` container (or with a local Node.js 22 if Docker isn't usable), running the tests first. A failing test stops the release.
3. Plans against the live `wall-ui/console/`: `NEW`, `REPLACE`, `REMOVE` per file. The live folder carries `.release.json` (commit and file hashes); if any live file differs from what the last release installed, the release stops untouched.
4. Installs by swapping the whole folder, after moving the old one to `~/console-releases/backups/<time>-<commit>/` (outside the served tree).
5. Checks `index.html` and every asset return HTTP 200 at `http://127.0.0.1:3098/console/`; on any failure it puts the previous folder back.
6. Prints the undo command (`bash ~/console-releases/backups/<…>/UNDO.sh`).

Nothing else in wall-ui changes, and nginx is not touched: wall-ui is already served as a whole, so `/console/` works as soon as the folder exists.

## One-time setup

```bash
git clone git@github.com:ApexXV/ap3x-console.git ~/src/ap3x-console
echo "alias console-release='~/src/ap3x-console/deploy/rackmain1-release.sh'" >> ~/.bashrc && . ~/.bashrc
docker pull node:22-bookworm-slim     # optional: the first release pulls it anyway
```

Use the same SSH key or deploy key the other repositories use on rackmain1.

## Screens

| Screen | URL |
| --- | --- |
| LabTouch1 (800×480) | `http://rackmain1:3098/console/index.html?layout=lab-touch` |
| Operations (1080p and up) | `http://rackmain1:3098/console/index.html?layout=ops-1080` |
| Command 57 (57-inch wall) | `http://rackmain1:3098/console/index.html?layout=command-57` |
| Command 57 on a 1080p screen | `http://rackmain1:3098/console/index.html?layout=command-1080` |
