#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

xcodegen generate

PBXPROJ="$ROOT_DIR/Vostok.xcodeproj/project.pbxproj"
LC_ALL=C LANG=C perl -0pi -e 's/objectVersion = 77;/objectVersion = 56;/g; s/\n\s*minimizedProjectReferenceProxies = 1;//g; s/\n\s*preferredProjectObjectVersion = 77;//g;' "$PBXPROJ"

echo "Generated and patched $PBXPROJ for Xcode 15.4 compatibility."
