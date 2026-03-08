# System Design: CommuteCapture — In-Car Speech Data Collection Platform

> A single-user CLI-driven backend that captures high-value speech data during daily car commutes, uploading audio directly to MinIO and persisting rich metadata in Postgres for eventual licensing to AI/ML companies. A Safari PWA frontend will be added in a future phase.

---

## 1. Requirements

### Functional Requirements

1. **The system should expose JSON APIs that allow a client to start a commute session, receive prompts, upload WAV audio to MinIO via presigned URLs, and record rich metadata (GPS, device motion, orientation, audio route, device info) — all in an automated prompt loop.**
2. **The system should schedule prompts to maximize dataset diversity and coverage across prompt categories, recording conditions, and time periods — rather than always following a fixed sequence.**
3. **The system should expose JSON APIs for reviewing recordings, inspecting coverage, and managing prompts.**

### Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | **Upload reliability** | ≥99% of completed clips per session successfully uploaded to MinIO and recorded in Postgres without manual intervention |
| NFR-2 | **Upload visibility** | A successfully uploaded clip and its metadata available for review within 60 seconds of clip completion |
| NFR-3 | **Capacity** | Sustained ingest of ≥200 MB/day and ≥6 GB/month on a single-host deployment without architectural changes |
| NFR-4 | **Deployment simplicity** | Deployable by one operator on one host via Docker Compose in ≤30 minutes (excluding DNS/TLS) |

### Constraints / Non-Goals

- **Single-user system** — no authentication, authorization, or multi-tenant isolation
- **Always-online** — assumes network connectivity during capture and upload
- **CLI/API only** — no frontend UI in current scope (see §8 Future Development)
- **Single-host deployment** — Docker Compose only; no Kubernetes, horizontal scaling, or HA failover
- **Current scope excludes** transcript correction, dataset curation/export pipelines, buyer-facing packaging, and Safari PWA frontend (see §8 Future Development)

---

## 2. Core Entities

```
Commute     — A driving session with start/end lifecycle
Prompt      — A question or instruction spoken to the user
Recording   — One uploaded WAV response for a prompt within a commute
```

---

## 3. API / System Interface

All endpoints under `/v1` prefix. REST with JSON request/response bodies.

### JSON APIs

| Endpoint | Method | Purpose | Request | Response |
|---|---|---|---|---|
| `/v1/commutes` | POST | Start a commute session | `{ start_lat, start_lon, start_accuracy, device_motion_json, device_orientation_json, screen_info_json, audio_route_json, client_ua, client_platform, client_viewport, client_locale, client_timezone }` | `{ id, status, started_at, prompt, remaining_count }` |
| `/v1/commutes/{id}` | GET | Get commute status + current prompt | — | `{ id, status, current_prompt_index, prompt }` |
| `/v1/commutes/{id}` | PATCH | End a commute | `{ "status": "ended" }` | `{ id, status, ended_at }` |
| `/v1/uploads` | POST | Get presigned PUT URL for MinIO | `{ commute_id, prompt_id, content_type }` | `{ upload_url, object_url, expires_in }` |
| `/v1/recordings` | POST | Notify backend after successful upload | `{ commute_id, prompt_id, object_url, object_key, duration_ms, capture_started_at, capture_ended_at, upload_completed_at, location_lat, location_lon, location_speed, location_heading, location_altitude, location_accuracy, motion_accel_x, motion_accel_y, motion_accel_z, motion_accel_gravity_x, motion_accel_gravity_y, motion_accel_gravity_z, motion_rot_alpha, motion_rot_beta, motion_rot_gamma, motion_interval_ms, orientation_alpha, orientation_beta, orientation_gamma, orientation_absolute, compass_heading, compass_accuracy, audio_track_settings_json, audio_devices_json, audio_context_sample_rate, audio_context_base_latency, screen_orientation_type, screen_orientation_angle, client_ua, client_platform, client_locale, file_size_bytes, content_type }` | `{ recording_id, next_prompt, remaining_count }` |
| `/v1/recordings` | GET | List recordings with filters | `?commute_id=...&category=...&limit=50&offset=0` | `{ recordings: Recording[], total }` |
| `/v1/recordings/{id}` | GET | Get single recording detail | — | `Recording` |
| `/v1/prompts` | GET | List prompts | `?active=true` | `Prompt[]` |
| `/v1/prompts` | POST | Admin: add a prompt | `{ text, category, ... }` | `{ id, text, ... }` |
| `/v1/prompts/coverage` | GET | Coverage summary | — | `{ by_category, by_prompt, underrepresented }` |

---

## 4. Data Flow

### A. Capture Flow

```
 1. Client sends POST /v1/commutes with GPS + device metadata
 2. ← { commute_id, first prompt }

 ┌── PROMPT LOOP ──────────────────────────────────────┐
 │  3. → POST /v1/uploads { commute_id, prompt_id }     │
 │  4. ← { presigned PUT URL, object_url }              │
 │  5. Client records audio (10s WAV)                    │
 │  6. → PUT {presigned_url} with WAV blob (direct to    │
 │       MinIO, bypasses backend)                        │
 │  7. → POST /v1/recordings { object_url, duration_ms,  │
 │       object_key, timestamps, location, motion,       │
 │       orientation, compass, audio_route, device_info } │
 │  8. ← { recording_id, next_prompt, remaining_count }  │
 │  9. Cooldown, repeat with next_prompt                 │
 └──────────────────────────────────────────────────────┘

10. Client sends PATCH /v1/commutes/{id} { "status": "ended" }
```

### B. Review & Coverage Flow

```
1. GET /v1/recordings → browse recordings with metadata
2. GET /v1/prompts/coverage → identify underrepresented categories
```

---

## 5. High-Level Design

### Tech Stack

| Layer | Technology |
|---|---|
| **Server** | Express.js (Node.js) — JSON APIs + static files |
| **Database** | `pg` (node-postgres) + raw SQL |
| **Object Storage** | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for MinIO |
| **Deployment** | Docker Compose: `app`, `db`, `minio`, `minio-setup` |

### Architecture

```
┌─────────────────────────────────────────────────────┐
│              Docker Compose Network                  │
│                                                      │
│  ┌───────────────────────┐                           │
│  │   Express.js Server   │                           │
│  │     (Node.js)         │                           │
│  │                       │                           │
│  │  JSON API routes:     │                           │
│  │  /v1/commutes         │                           │
│  │  /v1/uploads ─────────┼──── presigned PUT URL ────┤
│  │  /v1/recordings       │                           │
│  │  /v1/prompts          │                           │
│  │  /v1/prompts/coverage │                           │
│  └───────┬───────────────┘                           │
│          │                                           │
│          │ pg (node-postgres)        ┌──────────────┐│
│          │                           │    MinIO     ││
│          ▼                           │ (S3-compat)  ││
│  ┌───────────────────┐               │              ││
│  │   PostgreSQL 16   │               │ commute-     ││
│  │                   │               │ audio/       ││
│  │  commutes         │               │  commutes/   ││
│  │  prompts          │               │   {id}/      ││
│  │  recordings       │               │    {p}.wav   ││
│  └───────────────────┘               └──────────────┘│
└─────────────────────────────────────────────────────┘
```

### Request Walkthroughs

#### `POST /v1/commutes` — Start Session
1. Client sends flat fields: `start_lat`, `start_lon`, `start_accuracy` (GPS) and device metadata
2. Server inserts `commutes` row with `status: 'active'`, stores all fields
3. Server selects the first prompt using the scheduling algorithm
4. Server returns `{ id, status, started_at, prompt, remaining_count }`

#### `POST /v1/uploads` — Get Presigned URL
1. Client sends `{ commute_id, prompt_id, content_type }`
2. Server generates object key: `commutes/{commute_id}/{prompt_id}-{uuid_hex}.wav`
3. Server creates presigned PUT URL via `@aws-sdk/s3-request-presigner` (120s expiry)
4. Server returns `{ upload_url, object_url, expires_in }`
5. No database write — this is stateless

#### `PUT {presigned_url}` — Upload Audio (client → MinIO direct)
1. Client PUTs the WAV blob directly to MinIO using the presigned URL
2. Bypasses the Express server entirely

#### `POST /v1/recordings` — Record Metadata
1. Client sends all metadata as flat fields including GPS, motion, orientation, compass, audio route, and device info
2. Server inserts `recordings` row with all metadata
3. Server snapshots `prompt_text_snapshot` from the current prompt text
4. Server advances `commutes.current_prompt_index`
5. Server selects next prompt using the scheduling algorithm
6. Server returns `{ recording_id, next_prompt, remaining_count }`

#### `PATCH /v1/commutes/{id}` — End Session
1. Client sends `{ "status": "ended" }`
2. Server sets `ended_at = NOW()`, `status = 'ended'`

### Non-Obvious Schema Notes

These are the fields that warrant explanation — standard fields like `id`, `created_at`, `status`, `text` are omitted.

**commutes:**
| Field | Purpose |
|---|---|
| `start_lat`, `start_lon`, `start_accuracy` | GPS coordinates at session start (flat NUMERIC/REAL columns) |
| `device_motion_json` | Snapshot of DeviceMotionEvent data at session start (JSONB) |
| `device_orientation_json` | Snapshot of DeviceOrientationEvent data at session start (JSONB) |
| `screen_info_json` | Screen dimensions, pixel ratio, orientation at session start (JSONB) |
| `audio_route_json` | Audio devices and context metadata at session start (JSONB) |
| `client_ua`, `client_platform`, `client_viewport`, `client_locale`, `client_timezone` | Device/browser snapshot at session start (flat TEXT columns) |

**prompts:**
| Field | Purpose |
|---|---|
| `category` | Prompt type: `free_form`, `task_oriented`, `short_command`, `hard_transcription`, `read_speech`, `turn_taking` |
| `tags` (JSONB) | Freeform labels for filtering |
| `target_contexts` (JSONB) | Ideal recording conditions: highway, city, rain, etc. |
| `pair_group_id` | Links prompts that should be recorded in both parked and driving conditions |
| `canonical_transcript` | Expected transcript text for `read_speech` and `hard_transcription` types (used for WER benchmarking) |
| `priority` | Admin-set boost for the scheduling algorithm |

**recordings:**
| Field | Purpose |
|---|---|
| `object_key` | MinIO storage path without hostname (e.g., `commutes/{id}/{p}.wav`) — used by orphan cleanup job to diff MinIO keys against DB |
| `prompt_text_snapshot` | Denormalized copy of prompt text at recording time — ensures export accuracy even if prompt row is later deactivated and replaced |
| `capture_started_at` / `capture_ended_at` | Client-side timestamps around the 10s recording window |
| `upload_completed_at` | Client-side timestamp after PUT completes — enables upload latency analysis |
| `capture_status` | Lifecycle state: `uploaded` (default) |
| `location_lat`, `location_lon`, `location_accuracy` | GPS position at recording time (flat NUMERIC/REAL columns) |
| `location_speed`, `location_heading`, `location_altitude` | GPS motion data at recording time (nullable REAL columns — may be null on iPhone) |
| `motion_accel_x/y/z` | Device acceleration without gravity at recording time (REAL, nullable) |
| `motion_accel_gravity_x/y/z` | Device acceleration including gravity at recording time (REAL, nullable) |
| `motion_rot_alpha/beta/gamma` | Device rotation rate at recording time (REAL, nullable) |
| `motion_interval_ms` | DeviceMotionEvent interval hint in ms (REAL, nullable) |
| `orientation_alpha/beta/gamma` | Device orientation angles at recording time (REAL, nullable) |
| `orientation_absolute` | Whether orientation is absolute or relative (BOOLEAN, nullable) |
| `compass_heading` | Safari webkitCompassHeading in degrees (REAL, nullable) |
| `compass_accuracy` | Safari webkitCompassAccuracy in degrees (REAL, nullable) |
| `audio_track_settings_json` | Full `MediaStreamTrack.getSettings()` output (JSONB) — reveals actual sample rate, DSP flags |
| `audio_devices_json` | `navigator.mediaDevices.enumerateDevices()` snapshot (JSONB) — mic vs headset vs bluetooth |
| `audio_context_sample_rate` | `AudioContext.sampleRate` (INTEGER, nullable) |
| `audio_context_base_latency` | `AudioContext.baseLatency` in seconds (REAL, nullable) |
| `screen_orientation_type` | `screen.orientation.type` e.g. "portrait-primary" (TEXT, nullable) |
| `screen_orientation_angle` | `screen.orientation.angle` in degrees (INTEGER, nullable) |
| `client_ua`, `client_platform`, `client_locale` | Browser context at recording time (flat TEXT columns) |

---

## 6. Deep Dives

### 6.1 Upload Reliability & Orphan Cleanup

**Presigned upload flow:**
```
Client                      Express                     MinIO
   │                           │                           │
   │── POST /v1/uploads ──────►│                           │
   │   {commute_id, prompt_id} │                           │
   │                           │── getSignedUrl() ────────►│
   │◄── {upload_url,           │                           │
   │     object_url,           │                           │
   │     expires_in: 120}      │                           │
   │                           │                           │
   │── PUT {upload_url} ──────────────────────────────────►│
   │   Body: WAV blob          │                           │
   │                           │                           │
   │── POST /v1/recordings ───►│                           │
   │   {object_url, ...}       │                           │
```

**Object key pattern:** `commutes/{commute_id}/{prompt_id}-{uuid_hex}.wav`

**Storage config:**
- Internal endpoint: `http://minio:9000` (within Docker network)
- Public endpoint: `MINIO_PUBLIC_ENDPOINT` (presigned URLs)
- Bucket: `commute-audio` (private, no anonymous access)
- Presign expiration: 120 seconds

**Failure modes:**

| Failure | Handling |
|---|---|
| `POST /v1/uploads` fails | Client retries or stops |
| MinIO PUT fails | Client retries up to 2× |
| `POST /v1/recordings` fails after PUT | Client retries up to 2×; audio exists in MinIO as orphan |

**Orphan cleanup:** Periodic job lists MinIO objects and diffs against `recordings.object_key` to find objects without metadata rows.

---

### 6.2 Automatic Metadata Capture

All metadata is captured automatically via browser APIs. The user grants permissions once — everything else requires zero interaction.

**Per-recording metadata (captured by client):**

| Field | Source | Permission |
|---|---|---|
| `location_lat` / `location_lon` | Geolocation API `watchPosition` | Location (one-time) |
| `location_speed` | `coords.speed` (m/s, may be null) | Location |
| `location_heading` | `coords.heading` (degrees, may be null) | Location |
| `location_altitude` | `coords.altitude` (may be null) | Location |
| `location_accuracy` | `coords.accuracy` (meters) | Location |
| `motion_accel_x/y/z` | `DeviceMotionEvent.acceleration` | Motion (gesture-gated on iOS 13+) |
| `motion_accel_gravity_x/y/z` | `DeviceMotionEvent.accelerationIncludingGravity` | Motion |
| `motion_rot_alpha/beta/gamma` | `DeviceMotionEvent.rotationRate` | Motion |
| `motion_interval_ms` | `DeviceMotionEvent.interval` | Motion |
| `orientation_alpha/beta/gamma` | `DeviceOrientationEvent` | Motion |
| `orientation_absolute` | `DeviceOrientationEvent.absolute` | Motion |
| `compass_heading` | Safari `webkitCompassHeading` (non-standard) | Motion |
| `compass_accuracy` | Safari `webkitCompassAccuracy` (non-standard) | Motion |
| `audio_track_settings_json` | `MediaStreamTrack.getSettings()` | Microphone |
| `audio_devices_json` | `navigator.mediaDevices.enumerateDevices()` | Microphone |
| `audio_context_sample_rate` | `AudioContext.sampleRate` | None |
| `audio_context_base_latency` | `AudioContext.baseLatency` | None |
| `screen_orientation_type` | `screen.orientation.type` | None |
| `screen_orientation_angle` | `screen.orientation.angle` | None |
| `capture_started_at` / `capture_ended_at` | `Date.now()` around recording | None |
| `upload_completed_at` | `Date.now()` after PUT completes | None |
| `client_ua` | `navigator.userAgent` | None |
| `client_platform` | `navigator.platform` | None |
| `client_locale` | `navigator.language` | None |
| `file_size_bytes` | `blob.size` | None |

**Per-session metadata (at session start):**

| Field | Source | Permission |
|---|---|---|
| `start_lat` / `start_lon` / `start_accuracy` | GPS coordinates at session start | Location |
| `device_motion_json` | Full DeviceMotionEvent snapshot | Motion |
| `device_orientation_json` | Full DeviceOrientationEvent snapshot | Motion |
| `screen_info_json` | `screen.*`, `devicePixelRatio`, `visualViewport` | None |
| `audio_route_json` | `enumerateDevices()` + `AudioContext` metadata | Microphone |
| `client_timezone` | `Intl.DateTimeFormat().resolvedOptions()` | None |

**Guardrails:**
- `speed`, `heading`, `altitude` may be `null` on iPhone — store as nullable, never assume
- Motion/orientation data is in **device coordinate frame**, not vehicle frame — store raw, derive later
- Gate derived labels on `accuracy` — ignore fixes with accuracy > 100m
- Compass can be noisy in cars (metal, magnets, charging hardware) — store raw `compass_accuracy`
- Safari may apply DSP to mic input regardless of constraints — always store `audio_track_settings_json` as truth

**APIs NOT available on Safari iOS (do not attempt):**
- Battery Status API (`navigator.getBattery()`)
- Network Information API (`navigator.connection`)
- Web Bluetooth
- Generic Sensor APIs (standalone Accelerometer, Gyroscope, Magnetometer)
- Ambient Light Sensor
- Barometer / pressure sensor
- Proximity sensor
- Device Memory API

**What is NOT auto-captured (future audio-derived inference):**

| Field | Why it can't be auto-detected | Future approach |
|---|---|---|
| Windows open/closed | No browser API for cabin state | Wind-noise spectral analysis |
| HVAC on/off | No browser API | Fan/blower spectral signature |
| Music playing | No system audio state API | Audio classifier on recording |
| Passengers | No browser API | Multi-voice detection |
| Traffic severity | GPS speed is a rough proxy | Stop-and-go pattern scoring |

---

### 6.3 Prompt Scheduling & Dataset Coverage

**Baseline behavior:** Strict `sequence_index` ordering — prompt N, then N+1.

**Upgraded design:** Replace `get_next_prompt()` internals with a scoring function while preserving the same API contract (next prompt still comes back in the `POST /recordings` response).

**Scoring algorithm:**
```javascript
function scorePrompt(prompt, commuteId, counts) {
  if (counts.recordedInCommute.has(prompt.id)) return -1;

  let score = 0;

  // Coverage gap: fewer recordings → higher priority
  const total = counts.byPrompt.get(prompt.id) ?? 0;
  score += Math.max(0, TARGET_PER_PROMPT - total) * COVERAGE_WEIGHT;

  // Category gap: underrepresented categories score higher
  const catCount = counts.byCategory.get(prompt.category) ?? 0;
  if (catCount < counts.avgPerCategory) {
    score += (counts.avgPerCategory - catCount) * CATEGORY_WEIGHT;
  }

  // Recency penalty: don't repeat same prompt too often
  const daysSince = counts.daysSinceLastByPrompt.get(prompt.id);
  if (daysSince != null && daysSince < 3) score -= RECENCY_PENALTY;

  // Admin priority boost
  score += (prompt.priority ?? 0) * PRIORITY_WEIGHT;

  return score;
}
```

**Category mix targets per session:**

| Category | Target % | Best Conditions |
|---|---|---|
| `free_form` | 30% | Any |
| `task_oriented` | 25% | City / moderate noise |
| `short_command` | 20% | Highway / high noise |
| `hard_transcription` | 10% | Any (names, numbers, addresses) |
| `read_speech` | 10% | Parked / quiet preferred |
| `turn_taking` | 5% | City / moderate |

**Paired recordings:** Prompts with the same `pair_group_id` should be scheduled in both parked and driving conditions. The scheduler boosts paired prompts recorded in one condition but not the other.

---

## 7. Migration Plan

```
Phase 1: CLI/API BACKEND (current scope)
├── Express.js JSON API server
├── PostgreSQL schema: commutes, prompts, recordings
├── MinIO presigned upload flow
├── Prompt scheduling with scoring algorithm
├── All sensor/device metadata columns
├── Docker Compose deployment
└── Effort: M

Phase 2: SAFARI PWA FRONTEND (future)
├── Capture page: Vanilla JS (extendable-media-recorder + WAV + speechSynthesis)
├── DeviceMotion/Orientation permission + capture
├── Audio route detection + capture
├── Review/coverage pages: server-rendered HTML + HTMX
└── Effort: L

Phase 3: SMART PROMPT SCHEDULING
├── Replace baseline sequence_index with scoring function
├── Same API contract — no client changes
└── Effort: M
```

---

## 8. Future Development

### Safari PWA Frontend

A hands-free capture experience running on iPhone Safari as an installed PWA.

**Capture page (Vanilla JS):**
- `extendable-media-recorder` + WAV encoder for 10s clip recording
- `speechSynthesis` for TTS prompt playback
- `DeviceMotionEvent.requestPermission()` + `DeviceOrientationEvent.requestPermission()` on first tap
- `navigator.geolocation.watchPosition()` for continuous GPS
- `navigator.mediaDevices.getUserMedia()` with `echoCancellation: false` for raw audio
- `MediaStreamTrack.getSettings()` capture per recording
- `navigator.mediaDevices.enumerateDevices()` for audio route detection
- Screen Wake Lock API to prevent screen dimming
- `document.visibilitychange` listener to detect backgrounding
- Auto-advance prompt loop with 2-second cooldown

**Review/Coverage pages (HTMX):**
- `GET /v1/recordings` → HTML table with filters, audio playback
- `GET /v1/recordings/{id}` → detail view with all metadata
- `GET /v1/prompts/coverage` → coverage dashboard

**Safety guardrails:**
- Voice-only flow after start tap; no text input while driving
- Auto-advance between prompts
- "Goodbye. Commute complete." speech on session end

### Async Enrichment Pipeline

A backend worker that automatically processes uploaded recordings. Adds a `worker` container to Docker Compose (sharing the backend image), new database tables, and async job processing.

**New tables:**

| Table | Purpose |
|---|---|
| `recording_analyses` | Transcripts, SNR estimates, noise labels, speech/silence ratios, clipping flags |
| `recording_qc` | QC status (accepted/rejected/needs_review), rejection reasons |
| `processing_jobs` | Async job lifecycle (queued → running → succeeded/failed) with retry |

**Processing stages:**

| Stage | Tool | Outputs |
|---|---|---|
| Weather Lookup | Open-Meteo API | `weather_snapshot` JSONB on commutes + recordings (temp, condition, wind, precip) using stored GPS coords |
| Speed Bucket | Rule-based derivation | `speed_bucket` (parked/city/highway) from `location_speed`: parked (<1 m/s), city (1–22 m/s), highway (>22 m/s) |
| Transcription | Whisper (faster-whisper) | transcript text, language, confidence, word timestamps |
| Audio Analysis | librosa / custom | RMS dB, peak dB, SNR estimate, silence/speech ratio, clipping detection |
| Noise Classification | Classifier on non-speech frames | noise_labels: road, wind, rain, HVAC, music, siren |
| Auto QC | Rule-based | qc_status, rejection_reason (no speech, clipping, too short, etc.) |

**Implementation:** Postgres-backed job table with `SELECT ... FOR UPDATE SKIP LOCKED` polling — simpler than Celery/Redis/SQS and sufficient for single-user throughput (~100 recordings/day).

### Dataset Export Packaging

Build productized dataset packages for licensing.

**Export package structure:**
```
commute-capture-asr-v1/
├── README.md              # Data card: methodology, speaker info, stats
├── manifest.csv           # One row per recording
├── stats.json             # Aggregate statistics
├── audio/
│   ├── train/
│   ├── dev/
│   └── test/
└── checksums.sha256
```

**Manifest columns:** recording_id, prompt_text, prompt_category, audio_path, duration_ms, transcript, confidence, SNR, noise_labels, speech_ratio, qc_status, capture_date, split

### Other Future Enhancements

- **Configurable recording duration** with VAD-based endpointing (instead of fixed 10s)
- **Disable browser DSP** (`echoCancellation: false`) for higher raw data value
- **Ambient baseline clips** at session start for noise profiling
- **Multi-user expansion** with auth and consent framework
- **Marketplace integration** (Datarade, Defined.ai) for automated dataset listing
- **Real-time transcription** feedback during commute
- **ML-based prompt scheduling** replacing rule-based scoring
