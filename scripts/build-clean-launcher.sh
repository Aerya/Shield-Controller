#!/usr/bin/env bash
# Rebuild the optional APK without connecting to a device. Review and update its SHA-256 after building.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
git clone https://github.com/Gathin23/cleanyourtv "$BUILD_DIR/source"
git -C "$BUILD_DIR/source" checkout --detach fcde1eedb4d6cc5ab683a6e0e9e1bc79229b898e
docker build -t shield-clean-builder "$BUILD_DIR/source/tools/docker"
# Keep this private volume: it retains the signing key required for compatible updates.
# A fresh key produces a different APK/signature; never uninstall a user's app to work around it.
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$BUILD_DIR/source:/repo" -v shield-clean-gradle:/gradle -w /repo/launcher \
  shield-clean-builder sh ./gradlew --no-daemon --console=plain testReleaseUnitTest lintRelease assembleRelease
cp "$BUILD_DIR/source/launcher/app/build/outputs/apk/release/app-release.apk" "$ROOT/assets/launchers/cleanyourtv.apk"
sha256sum "$ROOT/assets/launchers/cleanyourtv.apk"
