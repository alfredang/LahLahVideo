#!/usr/bin/env bash
# LahLah Video installer for macOS.
#   curl -fsSL https://raw.githubusercontent.com/alfredang/LahLahVideo/main/install/install.sh | bash
# Options (pass after `bash -s --` when piping):
#   --dry-run          find the right download and print the plan, change nothing
#   --version vX.Y.Z   install a specific release instead of the latest
#   --with-claude      also connect Claude: opens the LahLah Video extension in Claude Desktop
#                      and registers the MCP server with Claude Code (if installed)
set -euo pipefail

REPO="alfredang/LahLahVideo"
APP="LahLah Video"
DRY_RUN=0
WITH_CLAUDE=0
VERSION="latest"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --with-claude) WITH_CLAUDE=1 ;;
    --version) VERSION="${2:-latest}"; shift ;;
    -h|--help) sed -n '2,8p' "$0" 2>/dev/null || true; exit 0 ;;
  esac
  shift
done

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS. On Windows, open PowerShell and run:
  irm https://raw.githubusercontent.com/alfredang/LahLahVideo/main/install/install.ps1 | iex"

# Apple silicon reports x86_64 under Rosetta; ask the kernel instead.
ARCH="$(uname -m)"
if [ "$ARCH" = "x86_64" ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; fi
case "$ARCH" in
  arm64) SUFFIX="_aarch64.dmg"; LABEL="Apple silicon (M1 or newer)" ;;
  x86_64) SUFFIX="_x64.dmg"; LABEL="Intel" ;;
  *) die "Unsupported Mac processor: $ARCH" ;;
esac
say "Mac with $LABEL processor"

if [ "$VERSION" = "latest" ]; then API="https://api.github.com/repos/$REPO/releases/latest"; else API="https://api.github.com/repos/$REPO/releases/tags/$VERSION"; fi
say "Looking up the $VERSION release of $APP"
JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: lahlah-installer' "$API")" || die "Could not reach GitHub. Check your internet connection and try again."
URL="$(printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*'"$SUFFIX"'"' | head -n 1 | sed -E 's/.*"(https:[^"]+)"/\1/')"
TAG="$(printf '%s' "$JSON" | grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed -E 's/.*"([^"]+)"$/\1/')"
[ -n "$URL" ] || die "The $TAG release has no $SUFFIX file yet. See https://github.com/$REPO/releases"
say "Found $TAG: $URL"

DEST="/Applications"
if [ ! -w "$DEST" ]; then DEST="$HOME/Applications"; fi

MCPB_URL="https://github.com/$REPO/releases/download/$TAG/lahlah-video.mcpb"
MCP_TGZ="https://github.com/$REPO/releases/download/$TAG/lahlah-video-mcp.tgz"

if [ "$DRY_RUN" = "1" ]; then
  if [ -d "$DEST/$APP.app" ]; then say "Dry run. $APP is already in $DEST; it would be quit and replaced."; fi
  say "Dry run. Would download the file above, copy \"$APP.app\" into $DEST, clear the quarantine flag and open it."
  if [ "$WITH_CLAUDE" = "1" ]; then say "Dry run. Would also open $MCPB_URL in Claude Desktop and run: claude mcp add --scope user lahlah-video -- npx -y $MCP_TGZ"; fi
  exit 0
fi

TMP="$(mktemp -d)"
MNT=""
cleanup() {
  if [ -n "$MNT" ]; then hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

say "Downloading"
curl -fL --progress-bar -o "$TMP/LahLahVideo.dmg" "$URL" || die "Download failed."

say "Opening the disk image"
MNT="$(hdiutil attach -nobrowse -readonly -noautoopen "$TMP/LahLahVideo.dmg" | awk -F'\t' '/\/Volumes\// {print $NF}' | tail -n 1)"
[ -n "$MNT" ] && [ -d "$MNT" ] || die "Could not open the disk image."
SRC_APP="$(find "$MNT" -maxdepth 1 -name '*.app' -print | head -n 1)"
[ -n "$SRC_APP" ] || die "No app found inside the disk image."

# Upgrading: quit the running copy and wait for it to close before replacing it.
if pgrep -f "$APP.app/Contents/MacOS/" >/dev/null 2>&1; then
  say "Closing the running $APP"
  osascript -e "quit app \"$APP\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$APP.app/Contents/MacOS/" >/dev/null 2>&1 || break; sleep 0.5; done
  pkill -f "$APP.app/Contents/MacOS/" >/dev/null 2>&1 || true
fi
mkdir -p "$DEST"
say "Copying $APP to $DEST"
rm -rf "$DEST/$APP.app"
ditto "$SRC_APP" "$DEST/$APP.app"

# The app is not notarised by Apple yet. Clearing the quarantine flag stops the
# "cannot be opened because the developer cannot be verified" block.
xattr -dr com.apple.quarantine "$DEST/$APP.app" 2>/dev/null || true

say "Starting $APP"
open "$DEST/$APP.app"
printf '\n\033[1;32m✓ LahLah Video %s is installed in %s and should now be open.\033[0m\n' "$TAG" "$DEST"
printf '  Tip: press Cmd+K inside the app and type "help" to see what you can say.\n'

if [ "$WITH_CLAUDE" = "1" ]; then
  say "Connecting Claude"
  if [ -d "/Applications/Claude.app" ] || [ -d "$HOME/Applications/Claude.app" ]; then
    mkdir -p "$HOME/Downloads"
    if curl -fsSL -o "$HOME/Downloads/lahlah-video.mcpb" "$MCPB_URL"; then
      open -a Claude "$HOME/Downloads/lahlah-video.mcpb" || open "$HOME/Downloads/lahlah-video.mcpb" || true
      say "Claude Desktop is showing the LahLah Video extension: click Install."
    else
      say "Could not download the Claude extension. Get it from https://github.com/$REPO/releases/latest"
    fi
  else
    say "Claude Desktop not found; skipping the extension."
  fi
  if command -v claude >/dev/null 2>&1; then
    if command -v npx >/dev/null 2>&1; then
      claude mcp remove --scope user lahlah-video >/dev/null 2>&1 || true
      claude mcp add --scope user lahlah-video -- npx -y "$MCP_TGZ" && say "Claude Code can now use LahLah Video (tool prefix: lahlah-video)."
    else
      say "Claude Code found but Node.js is missing; install Node.js 18+ to use the MCP server there."
    fi
  fi
fi
