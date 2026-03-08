#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:3000"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "✗ $desc (expected=$expected, got=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

check_not_empty() {
  local desc="$1" actual="$2"
  if [ -n "$actual" ] && [ "$actual" != "null" ]; then
    echo "✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "✗ $desc (was empty or null)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== CommuteCapture E2E Tests ==="
echo ""

# 1. Health check
echo "--- Health ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/healthz")
check "GET /healthz returns 200" "200" "$STATUS"

# 2. Prompts seeded
echo ""
echo "--- Prompts ---"
PROMPT_COUNT=$(curl -s "$API/v1/prompts?active=true" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
check "Seeded prompts count >= 300" "true" "$([ "$PROMPT_COUNT" -ge 300 ] && echo true || echo false)"

CATEGORIES=$(curl -s "$API/v1/prompts?active=true" | python3 -c "import sys,json; print(len(set(p['category'] for p in json.load(sys.stdin))))")
check "All 6 categories seeded" "6" "$CATEGORIES"

# 3. Start commute
echo ""
echo "--- Start Commute ---"
COMMUTE_RESP=$(curl -s -X POST "$API/v1/commutes" \
  -H "Content-Type: application/json" \
  -d '{
    "start_lat": 37.7749,
    "start_lon": -122.4194,
    "start_accuracy": 12,
    "device_motion_json": {"x": 0.1},
    "device_orientation_json": {"alpha": 10},
    "screen_info_json": {"width": 390, "height": 844},
    "audio_route_json": {"devices": []},
    "client_ua": "e2e-test",
    "client_platform": "macOS",
    "client_viewport": "390x844",
    "client_locale": "en-US",
    "client_timezone": "America/Los_Angeles"
  }')

COMMUTE_ID=$(echo "$COMMUTE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
COMMUTE_STATUS=$(echo "$COMMUTE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
FIRST_PROMPT_ID=$(echo "$COMMUTE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['prompt']['id'])")
REMAINING=$(echo "$COMMUTE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['remaining_count'])")

check_not_empty "Commute ID returned" "$COMMUTE_ID"
check "Commute status is active" "active" "$COMMUTE_STATUS"
check_not_empty "First prompt returned" "$FIRST_PROMPT_ID"
check "Remaining count > 0" "true" "$([ "$REMAINING" -gt 0 ] && echo true || echo false)"

# 4. Get commute status
echo ""
echo "--- Get Commute ---"
GET_STATUS=$(curl -s "$API/v1/commutes/$COMMUTE_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
check "GET commute returns active" "active" "$GET_STATUS"

# 5. Request presigned upload URL
echo ""
echo "--- Presigned Upload ---"
UPLOAD_RESP=$(curl -s -X POST "$API/v1/uploads" \
  -H "Content-Type: application/json" \
  -d "{\"commute_id\": \"$COMMUTE_ID\", \"prompt_id\": \"$FIRST_PROMPT_ID\", \"content_type\": \"audio/wav\"}")

UPLOAD_URL=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['upload_url'])")
OBJECT_URL=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['object_url'])")
OBJECT_KEY=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['object_key'])")
EXPIRES=$(echo "$UPLOAD_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['expires_in'])")

check_not_empty "Upload URL returned" "$UPLOAD_URL"
check_not_empty "Object URL returned" "$OBJECT_URL"
check_not_empty "Object key returned" "$OBJECT_KEY"
check "Expires in 120s" "120" "$EXPIRES"

# 6. Upload WAV to MinIO
echo ""
echo "--- MinIO Upload ---"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAV_FILE="$SCRIPT_DIR/../test/fixtures/silence.wav"
UPLOAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "Content-Type: audio/wav" \
  --upload-file "$WAV_FILE" \
  "$UPLOAD_URL")
check "PUT to MinIO returns 200" "200" "$UPLOAD_STATUS"

# 7. Record metadata
echo ""
echo "--- Record Metadata ---"
FILE_SIZE=$(wc -c < "$WAV_FILE" | tr -d ' ')
REC_RESP=$(curl -s -X POST "$API/v1/recordings" \
  -H "Content-Type: application/json" \
  -d "{
    \"commute_id\": \"$COMMUTE_ID\",
    \"prompt_id\": \"$FIRST_PROMPT_ID\",
    \"object_url\": \"$OBJECT_URL\",
    \"object_key\": \"$OBJECT_KEY\",
    \"duration_ms\": 1000,
    \"capture_started_at\": \"2025-01-01T10:00:00Z\",
    \"capture_ended_at\": \"2025-01-01T10:00:01Z\",
    \"upload_completed_at\": \"2025-01-01T10:00:02Z\",
    \"location_lat\": 37.7749,
    \"location_lon\": -122.4194,
    \"location_speed\": 13.4,
    \"location_heading\": 82,
    \"location_altitude\": 15,
    \"location_accuracy\": 8,
    \"motion_accel_x\": 0.1,
    \"motion_accel_y\": 0.2,
    \"motion_accel_z\": 0.3,
    \"motion_accel_gravity_x\": 0.1,
    \"motion_accel_gravity_y\": 9.7,
    \"motion_accel_gravity_z\": 0.2,
    \"motion_rot_alpha\": 0.2,
    \"motion_rot_beta\": 0.3,
    \"motion_rot_gamma\": 0.4,
    \"motion_interval_ms\": 16,
    \"orientation_alpha\": 10,
    \"orientation_beta\": 20,
    \"orientation_gamma\": 30,
    \"orientation_absolute\": true,
    \"compass_heading\": 80,
    \"compass_accuracy\": 15,
    \"audio_track_settings_json\": {\"sampleRate\": 48000, \"echoCancellation\": false},
    \"audio_devices_json\": [{\"kind\": \"audioinput\", \"label\": \"Built-in Microphone\"}],
    \"audio_context_sample_rate\": 48000,
    \"audio_context_base_latency\": 0.01,
    \"screen_orientation_type\": \"portrait-primary\",
    \"screen_orientation_angle\": 0,
    \"client_ua\": \"e2e-test\",
    \"client_platform\": \"macOS\",
    \"client_locale\": \"en-US\",
    \"file_size_bytes\": $FILE_SIZE,
    \"content_type\": \"audio/wav\"
  }")

RECORDING_ID=$(echo "$REC_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['recording_id'])")
NEXT_PROMPT=$(echo "$REC_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['next_prompt']['id'] if d['next_prompt'] else 'null')")
REC_REMAINING=$(echo "$REC_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['remaining_count'])")

check_not_empty "Recording ID returned" "$RECORDING_ID"
check_not_empty "Next prompt returned" "$NEXT_PROMPT"
check "Remaining decreased" "true" "$([ "$REC_REMAINING" -lt "$REMAINING" ] && echo true || echo false)"

# 8. Duplicate recording rejected
echo ""
echo "--- Duplicate Check ---"
DUP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/recordings" \
  -H "Content-Type: application/json" \
  -d "{
    \"commute_id\": \"$COMMUTE_ID\",
    \"prompt_id\": \"$FIRST_PROMPT_ID\",
    \"object_url\": \"$OBJECT_URL\",
    \"object_key\": \"${OBJECT_KEY}-dup\",
    \"duration_ms\": 1000,
    \"capture_started_at\": \"2025-01-01T10:00:00Z\",
    \"capture_ended_at\": \"2025-01-01T10:00:01Z\",
    \"upload_completed_at\": \"2025-01-01T10:00:02Z\",
    \"file_size_bytes\": $FILE_SIZE,
    \"content_type\": \"audio/wav\"
  }")
check "Duplicate recording returns 409" "409" "$DUP_STATUS"

# 9. Get recordings
echo ""
echo "--- List Recordings ---"
REC_LIST_TOTAL=$(curl -s "$API/v1/recordings?commute_id=$COMMUTE_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])")
check "Recordings list total is 1" "1" "$REC_LIST_TOTAL"

# 10. Get single recording
echo ""
echo "--- Get Recording ---"
REC_DETAIL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/v1/recordings/$RECORDING_ID")
check "GET recording detail returns 200" "200" "$REC_DETAIL_STATUS"

# Verify sensor metadata was stored
MOTION_X=$(curl -s "$API/v1/recordings/$RECORDING_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['motion_accel_x'])")
check "Motion accel_x stored" "0.1" "$MOTION_X"

COMPASS=$(curl -s "$API/v1/recordings/$RECORDING_ID" | python3 -c "import sys,json; print(float(json.load(sys.stdin)['compass_heading']))")
check "Compass heading stored" "80.0" "$COMPASS"

AUDIO_SR=$(curl -s "$API/v1/recordings/$RECORDING_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['audio_context_sample_rate'])")
check "Audio context sample rate stored" "48000" "$AUDIO_SR"

# 11. Coverage
echo ""
echo "--- Coverage ---"
COV_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/v1/prompts/coverage")
check "GET coverage returns 200" "200" "$COV_STATUS"

# 12. End commute
echo ""
echo "--- End Commute ---"
END_RESP=$(curl -s -X PATCH "$API/v1/commutes/$COMMUTE_ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "ended"}')
END_STATUS=$(echo "$END_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
check "Commute ended" "ended" "$END_STATUS"

# 13. Ended commute rejects new uploads
echo ""
echo "--- Post-End Guards ---"
ENDED_UPLOAD=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/uploads" \
  -H "Content-Type: application/json" \
  -d "{\"commute_id\": \"$COMMUTE_ID\", \"prompt_id\": \"$NEXT_PROMPT\", \"content_type\": \"audio/wav\"}")
check "Upload after end returns 409" "409" "$ENDED_UPLOAD"

# Double-end returns 409
DOUBLE_END=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$API/v1/commutes/$COMMUTE_ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "ended"}')
check "Double-end returns 409" "409" "$DOUBLE_END"

# Summary
echo ""
echo "========================"
echo "PASSED: $PASS"
echo "FAILED: $FAIL"
echo "========================"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
