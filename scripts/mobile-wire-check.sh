#!/usr/bin/env bash
# Runs the Android sync engine (real Java code: SyncEngine + HttpUploader) against a RUNNING ERP server and checks the
# result — wire-level proof that the phone and the server agree on the sync contract. No Android SDK needed.
#
#   BASE_URL=http://localhost:3100 ADMIN_EMAIL=admin@test.local ADMIN_PASSWORD=adminpass123 \
#   JARS=/path/to/jars scripts/mobile-wire-check.sh
#
# JARS: a folder with junit-4.13.2.jar, hamcrest-core-1.3.jar and json-20240303.jar (Maven Central).
set -euo pipefail
cd "$(dirname "$0")/.."
B="${BASE_URL:-http://localhost:3100}"
JARS="${JARS:?set JARS to a folder with junit, hamcrest-core and org.json jars}"
CP="$(ls "$JARS"/*.jar | tr '\n' ':')"
OUT="$(mktemp -d)"
JAR_COOKIES="$OUT/cj"
curl -s -c "$JAR_COOKIES" -X POST "$B/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL:-admin@test.local}\",\"password\":\"${ADMIN_PASSWORD:-adminpass123}\"}" > /dev/null
TOKEN=$(curl -s -b "$JAR_COOKIES" -X POST "$B/api/mobile/devices" -H 'content-type: application/json' \
  -d "{\"deviceId\":\"wirecheck-$(date +%s)-aaaaaaaa\",\"label\":\"wire check\",\"syncToken\":true}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['syncToken'])")
(cd android/app && javac -nowarn -d "$OUT" -cp "$CP" src/main/java/com/intensecare/erp/sync/*.java src/test/java/com/intensecare/erp/sync/*.java 2>&1 | grep -v "^Picked up" || true)
ERP_BASE_URL="$B" ERP_DEVICE_TOKEN="$TOKEN" java -cp "$OUT:$CP" org.junit.runner.JUnitCore com.intensecare.erp.sync.ServerWireIT 2>&1 | grep -v "^Picked up"
