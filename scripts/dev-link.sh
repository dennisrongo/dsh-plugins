#!/usr/bin/env bash
# dev-link.sh — macOS/Linux twin of dev-link.ps1: wire these plugin sources into
# your dsh profiles so builds self-deploy.
#
# Two jobs, both idempotent, and both undone by any `pnpm install`:
#
#   1. DEPENDENCY ANCHORING — delegated to scripts/anchor.mjs, which symlinks
#      each plugin's @deepseek-ai/* peers at the dsh CLI host's own copy. A
#      linked plugin is loaded through its REAL path, so Node resolves from
#      this repo, not from the profile; without anchors the harness dies at
#      boot with ERR_MODULE_NOT_FOUND.
#
#   2. LIVE DEPLOY — symlink <profile>/node_modules/@dennisrongo/<plugin> to
#      the plugin folder. pnpm materialises npm/`file:` deps as real directory
#      copies frozen at install time, so `pnpm run build` here does NOT reach
#      the profile. With the symlink the profile serves this repo's lib/
#      directly: client-half edits deploy on browser refresh, host-half edits
#      on profile restart. DSH Desktop runs a profile-repair install on
#      startup that can replace symlinks with copies — re-run this script if
#      served bundles stop matching the repo.
#
# Usage:
#   scripts/dev-link.sh                          # CLI profile `web` only
#   scripts/dev-link.sh --profiles web,mission-control
#   scripts/dev-link.sh --desktop-profiles web   # desktop profile named `web`
#   scripts/dev-link.sh --plugins dsh-weather    # just one package
#   scripts/dev-link.sh --no-anchor              # skip anchor.mjs (already run)
#
# Desktop profile root is derived per-OS:
#   macOS   ~/Library/Application Support/dsh-desktop/harness/profiles
#   Linux   $XDG_DATA_HOME/dsh-desktop/harness/profiles  (~/.local/share fallback)
#   Windows %APPDATA%/dsh-desktop/harness/profiles (run from git-bash)

set -euo pipefail

repoRoot="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pluginRoot="$repoRoot/plugins"

cliProfilesRoot="$HOME/.dsh/profiles"
case "$(uname -s)" in
  Darwin) desktopProfilesRoot="$HOME/Library/Application Support/dsh-desktop/harness/profiles" ;;
  Linux)  desktopProfilesRoot="${XDG_DATA_HOME:-$HOME/.local/share}/dsh-desktop/harness/profiles" ;;
  *)      desktopProfilesRoot="${APPDATA:-$HOME/AppData/Roaming}/dsh-desktop/harness/profiles" ;;
esac

profiles="web"
desktopProfiles=""
pluginsArg=""
doAnchor=1

while [ $# -gt 0 ]; do
  case "$1" in
    --profiles)          profiles="$2"; shift 2 ;;
    --desktop-profiles)  desktopProfiles="$2"; shift 2 ;;
    --plugins)           pluginsArg="$2"; shift 2 ;;
    --no-anchor)         doAnchor=0; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1 (see --help)" >&2; exit 2 ;;
  esac
done

# Plugin list: every folder under plugins/, or the requested subset.
if [ -n "$pluginsArg" ]; then
  IFS=',' read -r -a plugins <<< "$pluginsArg"
else
  plugins=()
  for d in "$pluginRoot"/*/; do
    plugins+=("$(basename "$d")")
  done
fi

anchored=0
if [ "$doAnchor" -eq 1 ]; then
  echo "== anchoring @deepseek-ai/* peers =="
  node "$repoRoot/scripts/anchor.mjs"
fi

# link_one <profileDir> <label>
link_one() {
  local profileDir="$1" label="$2" p dest
  if [ ! -d "$profileDir" ]; then
    echo "SKIP  $label — no such profile dir: $profileDir"
    return
  fi
  for p in "${plugins[@]}"; do
    if [ ! -d "$pluginRoot/$p" ]; then
      echo "SKIP  $label — no such plugin: $p"
      continue
    fi
    dest="$profileDir/node_modules/@dennisrongo/$p"
    mkdir -p "$(dirname "$dest")"
    if [ -L "$dest" ]; then
      rm "$dest"
    elif [ -d "$dest" ]; then
      # npm/pnpm install copy — safe to remove, reinstallable from the lockfile
      rm -rf "$dest"
    fi
    ln -s "$pluginRoot/$p" "$dest"
    echo "LINK  $label @dennisrongo/$p -> $pluginRoot/$p"
  done
}

IFS=',' read -r -a cliArr <<< "$profiles"
for name in "${cliArr[@]}"; do
  [ -z "$name" ] && continue
  link_one "$cliProfilesRoot/$name" "cli:$name"
done

IFS=',' read -r -a deskArr <<< "$desktopProfiles"
for name in "${deskArr[@]}"; do
  [ -z "$name" ] && continue
  link_one "$desktopProfilesRoot/$name" "desktop:$name"
done

echo
echo "Done. Client-half edits: browser refresh. Host-half edits: profile restart."
echo "Re-run after ANY 'pnpm install' — pnpm replaces links with copies."
