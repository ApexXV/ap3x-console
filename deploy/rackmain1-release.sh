#!/usr/bin/env bash
# One-command console release on rackmain1 (alias: console-release).
#
#   ~/src/ap3x-console/deploy/rackmain1-release.sh          # build, test, plan, ask, apply, verify
#   ~/src/ap3x-console/deploy/rackmain1-release.sh --yes    # no confirmation prompt
#   ~/src/ap3x-console/deploy/rackmain1-release.sh --plan   # build and show the plan only
#
# It fetches origin/main, builds that exact commit in a throwaway folder (in a
# node:22 container, or with a local npm), runs the tests, and installs dist/ as
# wall-ui/console/ by swapping the whole folder. Nothing else in wall-ui changes.
# A live console folder edited by hand stops the release. Undo with the command
# printed at the end (also saved as UNDO.sh beside the backup).

# Everything runs inside main(), which bash parses in full before running, so
# checking out a newer commit of this very file mid-run is safe.
main() {
  set -euo pipefail
  local repo="${AP3X_CONSOLE_REPO:-$HOME/src/ap3x-console}"
  local web="${AP3X_WALL_UI:-/home/ap3x/stacks/media-automation/wall-ui}"
  local releases="${AP3X_CONSOLE_RELEASES:-$HOME/console-releases}"
  local base_url="${AP3X_CONSOLE_BASE_URL:-http://127.0.0.1:3098}"
  local live="$web/console"
  local mode="ask"
  case "${1:-}" in
    "") ;; --yes|-y) mode="yes" ;; --plan) mode="plan" ;;
    -h|--help) sed -n '2,13p' "$0"; return 0 ;;
    *) echo "Unknown option: $1 (use --yes, --plan, or --help)" >&2; return 2 ;;
  esac
  say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
  fail() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }
  [ "$(id -un)" != "root" ] || fail "run as ap3x, not root"
  [ -d "$repo/.git" ] || fail "no Git clone at $repo (see docs/RELEASE.md one-time setup)"
  [ -d "$web" ] || fail "no wall-ui folder at $web"
  case "$live" in */wall-ui/console) ;; *) fail "unexpected live path $live" ;; esac

  if [ -z "${AP3X_RELEASE_REEXEC:-}" ]; then
    say "Fetching latest main"
    git -C "$repo" fetch --quiet origin main || fail "could not fetch from GitHub"
    git -C "$repo" checkout --quiet --detach origin/main || fail "could not check out origin/main"
    # Continue from the fetched copy of this script so its newest checks apply.
    AP3X_RELEASE_REEXEC=1 exec bash "$repo/deploy/rackmain1-release.sh" "$@"
  fi
  local sha short
  sha="$(git -C "$repo" rev-parse HEAD)"
  short="${sha:0:7}"
  echo "Commit: $(git -C "$repo" log -1 --format='%h %s' HEAD)"

  install -d -m 700 "$releases" "$releases/staging" "$releases/backups"
  local stage="$releases/staging/$sha"
  if [ -f "$stage/dist/index.html" ]; then
    say "Build for this commit already exists; reusing it"
  else
    say "Building and testing (a few minutes the first time)"
    local work; work="$(mktemp -d "$releases/staging/.build-XXXXXX")"
    git -C "$repo" archive "$sha" | tar -x -C "$work"
    local build='npm ci --no-audit --no-fund --loglevel=error && npm test && npm run build'
    if docker info >/dev/null 2>&1; then
      docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$work:/app" -w /app node:22-bookworm-slim sh -c "$build" \
        || { rm -rf "$work"; fail "build or tests failed on this commit (output above)"; }
    elif command -v npm >/dev/null; then
      (cd "$work" && sh -c "$build") || { rm -rf "$work"; fail "build or tests failed on this commit (output above)"; }
    else
      rm -rf "$work"; fail "needs Docker (preferred) or Node.js 22 with npm to build"
    fi
    install -d -m 700 "$stage"
    mv "$work/dist" "$stage/dist"
    rm -rf "$work"
  fi

  say "Plan"
  python3 - "$stage/dist" "$live" "$sha" <<'PY' || fail "plan failed (a live file was changed by hand, or the build is incomplete)"
import hashlib, json, os, sys
from pathlib import Path
new_root, live_root, sha = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]

def tree(root):
    out = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            sys.exit(f"symlink in {root}: {path}")
        if path.is_file() and path.name != ".release.json":
            out[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out

new = tree(new_root)
if "index.html" not in new or not any(k.startswith("assets/") for k in new):
    sys.exit("build has no index.html or assets/")
old = {}
if live_root.exists():
    record = live_root / ".release.json"
    if not record.is_file():
        sys.exit(f"{live_root} exists but was not installed by console-release; move it aside first")
    recorded = json.loads(record.read_text())["files"]
    old = tree(live_root)
    if old != recorded:
        changed = sorted(set(old) ^ set(recorded) | {k for k in old if recorded.get(k) not in (None, old[k])})
        sys.exit("live console was edited by hand: " + ", ".join(changed[:8]))
    print(f"CURRENT  {json.loads(record.read_text())['commit'][:7]}")
for name in sorted(set(new) | set(old)):
    if name not in old:
        state = "NEW"
    elif name not in new:
        state = "REMOVE"
    else:
        state = "IDENTICAL" if old[name] == new[name] else "REPLACE"
    if state != "IDENTICAL":
        print(f"{state:<9}console/{name}")
(new_root / ".release.json").write_text(json.dumps({"commit": sha, "files": new}, indent=2) + "\n")
PY
  [ "$mode" = plan ] && { echo; echo "Plan only; nothing changed."; return 0; }
  if [ "$mode" = ask ]; then
    read -r -p "Install $short as $live? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || { echo "Nothing changed."; return 0; }
  fi

  say "Installing"
  local backup="$releases/backups/$(date -u +%Y%m%dT%H%M%SZ)-$short"
  local next="$web/.console-next-$short"
  install -d -m 700 "$backup"
  rm -rf "$next"
  cp -a "$stage/dist" "$next"
  find "$next" -type d -exec chmod 755 {} + && find "$next" -type f -exec chmod 644 {} +
  local undo
  if [ -d "$live" ]; then
    mv "$live" "$backup/console"
    undo="rm -rf '$live' && mv '$backup/console' '$live'"
  else
    undo="rm -rf '$live'"
  fi
  mv "$next" "$live"
  printf '#!/usr/bin/env bash\n# Restore the console as it was before %s\nset -e\n%s\necho restored\n' "$short" "$undo" > "$backup/UNDO.sh"
  chmod 700 "$backup/UNDO.sh"

  say "Verifying"
  local failed=0 path code
  for path in index.html $(cd "$live" && find assets -type f | sort); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$base_url/console/$path")"
    printf '  %-48s HTTP %s\n' "console/$path" "$code"
    [ "$code" = 200 ] || failed=1
  done
  if [ "$failed" = 1 ]; then
    bash "$backup/UNDO.sh" >/dev/null
    fail "the console did not serve correctly; the previous version is back in place"
  fi
  say "Done: $short is live"
  echo "LabTouch1:  $base_url/console/index.html?layout=lab-touch  (from the lab: http://rackmain1:3098/console/index.html?layout=lab-touch)"
  echo "To undo:    bash $backup/UNDO.sh"
}

main "$@"
exit
