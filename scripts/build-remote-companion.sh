#!/usr/bin/env bash
# Requires JDK 17 and Android SDK platform/build-tools 34. No TV connection.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
: "${REMOTE_SIGNING_DIR:?Set REMOTE_SIGNING_DIR to a private persistent directory outside the repository}"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
OUTPUT="${REMOTE_APK_OUTPUT:-$ROOT/assets/launchers/shield-remote.apk}"
TOOLS="$ANDROID_HOME/build-tools/34.0.0"
JAR="$ANDROID_HOME/platforms/android-34/android.jar"
mkdir -p "$BUILD/classes" "$BUILD/gen" "$BUILD/dex" "$BUILD/test" "$REMOTE_SIGNING_DIR"
chmod 700 "$REMOTE_SIGNING_DIR"
# Dependency-free JVM regression tests run before packaging.
javac -d "$BUILD/test" "$ROOT/companion/src/org/shieldcontroller/remote/GestureEngine.java" "$ROOT/companion/tests/GestureEngineTest.java"
java -cp "$BUILD/test" org.shieldcontroller.remote.GestureEngineTest
"$TOOLS/aapt" package -f -m -M "$ROOT/companion/AndroidManifest.xml" -S "$ROOT/companion/res" -I "$JAR" -J "$BUILD/gen" -F "$BUILD/unsigned.apk"
find "$ROOT/companion/src" "$BUILD/gen" -name '*.java' > "$BUILD/sources"
javac -source 8 -target 8 -Xlint:-options -classpath "$JAR" -d "$BUILD/classes" @"$BUILD/sources"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.list"
"$TOOLS/d8" --lib "$JAR" --min-api 26 --output "$BUILD/dex" @"$BUILD/classes.list"
(cd "$BUILD/dex" && "$TOOLS/aapt" add "$BUILD/unsigned.apk" classes.dex)
"$TOOLS/zipalign" -p -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"
if [[ ! -f "$REMOTE_SIGNING_DIR/remote.jks" ]]; then
    if [[ ! -f "$REMOTE_SIGNING_DIR/password" ]]; then
        umask 077
        head -c 48 /dev/urandom | base64 > "$REMOTE_SIGNING_DIR/password"
    fi
    keytool -genkeypair -keystore "$REMOTE_SIGNING_DIR/remote.jks" -storepass:file "$REMOTE_SIGNING_DIR/password" \
      -keypass:file "$REMOTE_SIGNING_DIR/password" -alias remote -keyalg RSA -keysize 3072 -validity 10000 \
      -dname 'CN=Shield Controller Remote' >/dev/null 2>&1
fi
"$TOOLS/apksigner" sign --v4-signing-enabled false --ks "$REMOTE_SIGNING_DIR/remote.jks" --ks-key-alias remote \
    --ks-pass "file:$REMOTE_SIGNING_DIR/password" \
    --out "$OUTPUT" "$BUILD/aligned.apk"
"$TOOLS/apksigner" verify --verbose "$OUTPUT"
sha256sum "$OUTPUT"
