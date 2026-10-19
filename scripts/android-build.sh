#!/usr/bin/env bash
# Builds the Android app. The app is a thin shell around the HOSTED ERP, so the server address is baked in at build time.
#
#   CAP_SERVER_URL=https://erp.yourcompany.com scripts/android-build.sh apk     # installable test build (debug-signed)
#   CAP_SERVER_URL=https://erp.yourcompany.com scripts/android-build.sh aab     # Play Store bundle (needs android/keystore.properties)
#   CAP_SERVER_URL=https://erp.yourcompany.com scripts/android-build.sh release-apk
#
# Needs: Node 18+, JDK 21, the Android SDK (ANDROID_HOME, platform 36, build-tools). See docs/ANDROID.md.
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:-apk}"

if [[ -z "${CAP_SERVER_URL:-}" ]]; then
  echo "CAP_SERVER_URL is required (the https address of the deployed ERP)." >&2
  exit 1
fi
if [[ "$target" != "apk" && ! "$CAP_SERVER_URL" =~ ^https:// ]]; then
  echo "Release builds must use an https:// CAP_SERVER_URL." >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]]; then
  echo "ANDROID_HOME is not set — install the Android SDK first (docs/ANDROID.md)." >&2
  exit 1
fi

npm ci
npx cap sync android

cd android
case "$target" in
  apk)         ./gradlew assembleDebug;   echo "APK: android/app/build/outputs/apk/debug/app-debug.apk" ;;
  release-apk) ./gradlew assembleRelease; echo "APK: android/app/build/outputs/apk/release/" ;;
  aab)         ./gradlew bundleRelease;   echo "AAB: android/app/build/outputs/bundle/release/app-release.aab" ;;
  *) echo "usage: $0 apk|release-apk|aab" >&2; exit 1 ;;
esac
