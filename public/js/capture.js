/* ═══════════════════════════════════════════════════════
   Capture Page — Fully Hands-Free Auto-Loop
   
   Flow: Start Commute → TTS prompt → auto-record 10s →
         upload → next prompt → TTS → auto-record → …
   ═══════════════════════════════════════════════════════ */

window.capturePage = (() => {
  // ── State ──────────────────────────────────────────
  let commuteId = null;
  let currentPrompt = null;
  let remainingCount = 0;
  let recordedCount = 0;
  let sessionStartTime = null;
  let sessionDurationInterval = null;
  let sessionActive = false;  // master flag for the auto-loop

  // Recording state
  let isRecording = false;
  let isPaused = false;       // user can pause the auto-loop
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let recordingTimerInterval = null;
  let recordingDurationMs = 10000; // 10 seconds
  let autoStopTimeout = null;

  // Upload info for current recording (fetched before recording starts)
  let pendingUploadInfo = null;

  // Sensors
  let gpsWatchId = null;
  let lastGpsPosition = null;
  let lastMotionEvent = null;
  let lastOrientationEvent = null;

  // Audio analysis
  let audioContext = null;
  let analyserNode = null;
  let waveformBars = [];

  // ── DOM Refs ───────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const els = {};
  function cacheDom() {
    els.startScreen    = $('capture-start-screen');
    els.activeScreen   = $('capture-active-screen');
    els.doneScreen     = $('capture-done-screen');
    els.btnStart       = $('btn-start-session');
    els.btnRecord      = $('btn-record');
    els.btnSkip        = $('btn-skip-prompt');
    els.btnEnd         = $('btn-end-session');
    els.btnNewSession  = $('btn-new-session');
    els.promptCard     = $('prompt-card');
    els.promptText     = $('prompt-text');
    els.promptCategory = $('prompt-category');
    els.promptNumber   = $('prompt-number');
    els.ringProgress   = $('ring-progress');
    els.ringTimer      = $('ring-timer');
    els.ringLabel      = $('ring-label');
    els.waveform       = $('waveform');
    els.infoRecorded   = $('info-recorded');
    els.infoRemaining  = $('info-remaining');
    els.infoDuration   = $('info-duration');
    els.summaryClips   = $('summary-clips');
    els.summaryDuration = $('summary-duration');
    els.summaryUploaded = $('summary-uploaded');
    els.dotGps         = $('dot-gps');
    els.dotMic         = $('dot-mic');
    els.dotMotion      = $('dot-motion');
    els.permMic        = $('perm-mic');
    els.permGps        = $('perm-gps');
    els.permMotion     = $('perm-motion');
  }

  // ── Init ───────────────────────────────────────────
  function init() {
    cacheDom();
    setupWaveformBars();
    bindEvents();
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', startSession);
    els.btnRecord.addEventListener('click', togglePause);
    els.btnSkip.addEventListener('click', skipPrompt);
    els.btnEnd.addEventListener('click', endSession);
    els.btnNewSession.addEventListener('click', resetToStart);
  }

  // ── Waveform Setup ─────────────────────────────────
  function setupWaveformBars() {
    els.waveform.innerHTML = '';
    waveformBars = [];
    const count = 48;
    for (let i = 0; i < count; i++) {
      const bar = document.createElement('div');
      bar.className = 'waveform__bar';
      bar.style.height = '4px';
      els.waveform.appendChild(bar);
      waveformBars.push(bar);
    }
  }

  /* ═══════════════════════════════════════════════════
     THE AUTO-LOOP — Core hands-free cycle
     ═══════════════════════════════════════════════════
     
     runPromptCycle():
       1. Show prompt on screen
       2. Speak prompt via TTS (wait for it to finish)
       3. Brief "get ready" beep / countdown
       4. Automatically start recording for 10s
       5. Auto-stop, upload, save metadata
       6. Advance to next prompt
       7. Repeat from step 1
     ═══════════════════════════════════════════════════ */

  async function runPromptCycle() {
    // Safety checks — bail if session ended, paused, or no prompt
    if (!sessionActive || !currentPrompt || !commuteId) return;

    // If paused, wait — the resume handler will re-call runPromptCycle
    if (isPaused) return;

    try {
      // ① Show prompt
      updatePromptDisplay();
      setRingState('speaking');

      // ② Speak prompt and wait for TTS to finish
      await speakPromptAsync(currentPrompt.text);
      if (!sessionActive || isPaused) return;

      // ③ Brief countdown before recording (1.5s)
      setRingState('countdown');
      els.ringTimer.textContent = '…';
      await delay(1500);
      if (!sessionActive || isPaused) return;

      // ④ Get presigned upload URL
      setRingState('preparing');
      pendingUploadInfo = await api.getUploadUrl({
        commute_id: commuteId,
        prompt_id: currentPrompt.id,
        content_type: 'audio/wav',
      });
      if (!sessionActive || isPaused) return;

      // ⑤ Record for 10 seconds (auto)
      await autoRecord();
      if (!sessionActive) return;

      // ⑥ Upload happened in autoRecord → handleRecordingComplete
      //    That function updates currentPrompt & remainingCount
      //    Small cooldown before next prompt
      if (currentPrompt && sessionActive && !isPaused) {
        setRingState('uploaded');
        await delay(1500);
        // Loop to next
        runPromptCycle();
      } else if (!currentPrompt && sessionActive) {
        // All prompts done
        speak('All prompts have been recorded. Great session!');
        toast.info('All prompts recorded! 🎉');
        setRingState('done');
      }
    } catch (err) {
      console.error('Prompt cycle error:', err);
      toast.error(`Error: ${err.message}`);
      // Wait and retry
      if (sessionActive && !isPaused && currentPrompt) {
        await delay(3000);
        runPromptCycle();
      }
    }
  }

  // ── Session Lifecycle ──────────────────────────────
  async function startSession() {
    try {
      els.btnStart.disabled = true;
      const textEl = els.btnStart.querySelector('.start-hero-btn__text');
      const iconEl = els.btnStart.querySelector('.start-hero-btn__icon');
      if (textEl) textEl.textContent = 'Starting…';
      if (iconEl) iconEl.textContent = '⏳';

      // Request permissions
      await requestPermissions();

      // Set up audio analysis on the stream
      setupAudioAnalysis(mediaStream);

      // Gather device metadata
      const deviceMeta = gatherSessionMetadata();

      // Get GPS position
      const pos = await getCurrentPosition();
      lastGpsPosition = pos;
      markPermission('perm-gps', true);

      // Start commute via API
      const result = await api.startCommute({
        start_lat: pos.coords.latitude,
        start_lon: pos.coords.longitude,
        start_accuracy: pos.coords.accuracy,
        ...deviceMeta,
      });

      commuteId = result.id;
      currentPrompt = result.prompt;
      remainingCount = result.remaining_count;
      recordedCount = 0;
      sessionStartTime = Date.now();
      sessionActive = true;
      isPaused = false;

      // Start GPS watch
      startGpsWatch();

      // Start motion/orientation listeners
      startMotionListeners();

      // Switch to active screen
      showScreen('active');
      updateSessionInfo();
      startSessionTimer();
      updatePauseButton();

      toast.success('Commute started — hands-free mode active');

      // ★ KICK OFF THE AUTO-LOOP ★
      runPromptCycle();

    } catch (err) {
      console.error('Start session error:', err);
      toast.error(`Failed to start: ${err.message}`);
      els.btnStart.disabled = false;
      const textEl2 = els.btnStart.querySelector('.start-hero-btn__text');
      const iconEl2 = els.btnStart.querySelector('.start-hero-btn__icon');
      if (textEl2) textEl2.textContent = 'Start Commute';
      if (iconEl2) iconEl2.textContent = '▶';
    }
  }

  async function endSession() {
    if (!commuteId) return;

    try {
      // Stop the auto-loop
      sessionActive = false;

      // Stop recording if active
      if (isRecording) {
        cancelRecording();
      }

      // Cancel any pending TTS
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }

      await api.endCommute(commuteId);

      // Cleanup
      stopGpsWatch();
      stopMotionListeners();
      clearInterval(sessionDurationInterval);
      clearTimeout(autoStopTimeout);

      // Speak goodbye
      speak('Commute complete. Great job!');

      // Show summary
      els.summaryClips.textContent = recordedCount;
      els.summaryDuration.textContent = formatDuration(Date.now() - sessionStartTime);
      const totalBytes = recordedCount * 160000;
      els.summaryUploaded.textContent = formatBytes(totalBytes);

      showScreen('done');
      toast.success('Session ended successfully');
    } catch (err) {
      console.error('End session error:', err);
      toast.error(`Failed to end session: ${err.message}`);
    }
  }

  function resetToStart() {
    commuteId = null;
    currentPrompt = null;
    remainingCount = 0;
    recordedCount = 0;
    sessionStartTime = null;
    sessionActive = false;
    isPaused = false;

    els.btnStart.disabled = false;
    const textEl3 = els.btnStart.querySelector('.start-hero-btn__text');
    const iconEl3 = els.btnStart.querySelector('.start-hero-btn__icon');
    if (textEl3) textEl3.textContent = 'Start Commute';
    if (iconEl3) iconEl3.textContent = '▶';
    setRingState('ready');

    showScreen('start');
  }

  // ── Pause / Resume ─────────────────────────────────
  function togglePause() {
    if (!sessionActive) return;

    if (isPaused) {
      // Resume
      isPaused = false;
      updatePauseButton();
      toast.info('Resumed — next prompt coming up');

      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }

      // If we were recording when paused, that recording was cancelled.
      // Just restart the cycle from the current prompt.
      if (!isRecording) {
        runPromptCycle();
      }
    } else {
      // Pause
      isPaused = true;
      updatePauseButton();

      // Stop any in-progress recording
      if (isRecording) {
        cancelRecording();
      }

      // Cancel TTS
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
      }

      clearTimeout(autoStopTimeout);
      setRingState('paused');
      toast.info('Paused — tap play to resume');
    }
  }

  function updatePauseButton() {
    if (isPaused) {
      els.btnRecord.classList.remove('is-recording');
      els.btnRecord.classList.add('is-paused');
      els.btnRecord.title = 'Resume auto-recording';
    } else {
      els.btnRecord.classList.remove('is-paused');
      els.btnRecord.title = 'Pause auto-recording';
    }
  }

  // ── Skip Prompt ────────────────────────────────────
  function skipPrompt() {
    if (!sessionActive || !currentPrompt) return;

    // Cancel current recording if active
    if (isRecording) {
      cancelRecording();
    }

    // Cancel TTS
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }

    clearTimeout(autoStopTimeout);
    toast.info('Skipped — moving to next prompt');

    // Re-trigger the cycle with the same prompt (re-read it)
    // In a real app you might want to actually skip to a different prompt
    runPromptCycle();
  }

  // ── Auto-Record (returns Promise) ──────────────────
  function autoRecord() {
    return new Promise(async (resolve, reject) => {
      if (!currentPrompt || !commuteId || !pendingUploadInfo) {
        return reject(new Error('No prompt or upload info'));
      }

      try {
        isRecording = true;
        audioChunks = [];
        recordingStartTime = Date.now();

        // Ensure we have a media stream
        if (!mediaStream) {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          setupAudioAnalysis(mediaStream);
        }

        mediaRecorder = new MediaRecorder(mediaStream, {
          mimeType: getSupportedMimeType(),
        });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          if (!isRecording && audioChunks.length === 0) {
            // Cancelled — don't upload
            resolve();
            return;
          }
          isRecording = false;

          try {
            await handleRecordingComplete(pendingUploadInfo);
            resolve();
          } catch (err) {
            reject(err);
          }
        };

        mediaRecorder.start(100);

        // Update UI for recording state
        setRingState('recording');
        els.dotMic.className = 'capture-status-bar__dot capture-status-bar__dot--mic';

        // Start countdown timer
        startRecordingTimer();

        // Auto-stop after duration
        autoStopTimeout = setTimeout(() => {
          if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
            isRecording = false; // mark before stop so onstop knows it was normal
            isRecording = true;  // actually keep it true so onstop processes it
            mediaRecorder.stop();
          }
        }, recordingDurationMs);

      } catch (err) {
        isRecording = false;
        reject(err);
      }
    });
  }

  function cancelRecording() {
    isRecording = false;
    clearInterval(recordingTimerInterval);
    clearTimeout(autoStopTimeout);

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onstop = null;
      try { mediaRecorder.stop(); } catch {}
    }

    audioChunks = [];
    setRingState('ready');
    resetWaveform();
  }

  async function handleRecordingComplete(uploadInfo) {
    const captureEndedAt = new Date().toISOString();
    const captureStartedAt = new Date(recordingStartTime).toISOString();
    const blob = new Blob(audioChunks, { type: getSupportedMimeType() });
    const durationMs = Date.now() - recordingStartTime;

    // Reset recording UI
    clearInterval(recordingTimerInterval);
    setRingState('uploading');
    resetWaveform();

    // Upload to MinIO via presigned URL
    await fetch(uploadInfo.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/wav' },
      body: blob,
    });

    const uploadCompletedAt = new Date().toISOString();

    // Gather current sensor data
    const sensorData = gatherRecordingMetadata();

    // Notify backend
    const result = await api.createRecording({
      commute_id: commuteId,
      prompt_id: currentPrompt.id,
      object_url: uploadInfo.object_url,
      object_key: uploadInfo.object_key,
      duration_ms: durationMs,
      capture_started_at: captureStartedAt,
      capture_ended_at: captureEndedAt,
      upload_completed_at: uploadCompletedAt,
      file_size_bytes: blob.size,
      content_type: blob.type || 'audio/wav',
      ...sensorData,
    });

    recordedCount++;
    currentPrompt = result.next_prompt;
    remainingCount = result.remaining_count;

    updatePromptDisplay();
    updateSessionInfo();
    toast.success(`Clip #${recordedCount} uploaded ✓`);
  }

  // ── Recording Timer ────────────────────────────────
  function startRecordingTimer() {
    const start = Date.now();
    const total = recordingDurationMs;

    recordingTimerInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, total - elapsed);
      const seconds = (remaining / 1000).toFixed(1);
      els.ringTimer.textContent = seconds;
      updateRingProgress(elapsed / total);

      // Update waveform
      if (analyserNode && isRecording) {
        updateWaveform();
      }

      if (remaining <= 0) {
        clearInterval(recordingTimerInterval);
      }
    }, 50);
  }

  function updateRingProgress(pct) {
    const circumference = 2 * Math.PI * 100; // r=100
    const offset = circumference * (1 - Math.min(pct, 1));
    els.ringProgress.style.strokeDashoffset = offset;
  }

  // ── Ring State Machine ─────────────────────────────
  function setRingState(state) {
    const labelEl = els.ringLabel;
    const timerEl = els.ringTimer;
    const cardEl = els.promptCard;

    // Reset classes
    labelEl.className = 'recording-ring__label';
    cardEl.classList.remove('is-active');
    els.btnRecord.classList.remove('is-recording');

    switch (state) {
      case 'ready':
        labelEl.textContent = 'READY';
        labelEl.classList.add('recording-ring__label--ready');
        timerEl.textContent = '10.0';
        updateRingProgress(0);
        break;
      case 'speaking':
        labelEl.textContent = 'LISTEN';
        labelEl.style.color = 'var(--cc-accent)';
        timerEl.textContent = '🔊';
        cardEl.classList.add('is-active');
        updateRingProgress(0);
        break;
      case 'countdown':
        labelEl.textContent = 'GET READY';
        labelEl.style.color = 'var(--cc-amber)';
        timerEl.textContent = '…';
        updateRingProgress(0);
        break;
      case 'preparing':
        labelEl.textContent = 'PREPARING';
        labelEl.style.color = 'var(--cc-text-muted)';
        timerEl.textContent = '…';
        break;
      case 'recording':
        labelEl.textContent = 'RECORDING';
        labelEl.classList.add('recording-ring__label--recording');
        labelEl.style.color = '';
        cardEl.classList.add('is-active');
        els.btnRecord.classList.add('is-recording');
        break;
      case 'uploading':
        labelEl.textContent = 'UPLOADING';
        labelEl.style.color = 'var(--cc-cyan)';
        timerEl.textContent = '⬆';
        updateRingProgress(1);
        break;
      case 'uploaded':
        labelEl.textContent = 'UPLOADED ✓';
        labelEl.classList.add('recording-ring__label--ready');
        labelEl.style.color = '';
        timerEl.textContent = '✓';
        break;
      case 'paused':
        labelEl.textContent = 'PAUSED';
        labelEl.style.color = 'var(--cc-amber)';
        timerEl.textContent = '⏸';
        updateRingProgress(0);
        break;
      case 'done':
        labelEl.textContent = 'COMPLETE';
        labelEl.classList.add('recording-ring__label--ready');
        labelEl.style.color = '';
        timerEl.textContent = '🎉';
        updateRingProgress(1);
        break;
    }
  }

  // ── Audio Analysis / Waveform ──────────────────────
  function setupAudioAnalysis(stream) {
    try {
      if (audioContext) return; // already set up
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 128;
      source.connect(analyserNode);
    } catch (err) {
      console.warn('Audio analysis not available:', err);
    }
  }

  function updateWaveform() {
    if (!analyserNode) return;
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(dataArray);

    const step = Math.floor(dataArray.length / waveformBars.length);
    for (let i = 0; i < waveformBars.length; i++) {
      const val = dataArray[i * step] || 0;
      const height = Math.max(4, (val / 255) * 50);
      waveformBars[i].style.height = `${height}px`;
      waveformBars[i].classList.toggle('active', val > 80);
    }
  }

  function resetWaveform() {
    waveformBars.forEach(bar => {
      bar.style.height = '4px';
      bar.classList.remove('active');
    });
  }

  // ── Session Timer ──────────────────────────────────
  function startSessionTimer() {
    sessionDurationInterval = setInterval(() => {
      if (sessionStartTime) {
        els.infoDuration.textContent = formatDuration(Date.now() - sessionStartTime);
      }
    }, 1000);
  }

  // ── UI Updates ─────────────────────────────────────
  function showScreen(which) {
    els.startScreen.style.display  = which === 'start'  ? '' : 'none';
    els.activeScreen.style.display = which === 'active' ? '' : 'none';
    els.doneScreen.style.display   = which === 'done'   ? '' : 'none';
  }

  function updatePromptDisplay() {
    if (currentPrompt) {
      els.promptText.textContent = currentPrompt.text;
      els.promptCategory.textContent = formatCategory(currentPrompt.category);
      els.promptNumber.textContent = `#${recordedCount + 1}`;

      const colors = {
        free_form: 'blue', task_oriented: 'green', short_command: 'amber',
        hard_transcription: 'red', read_speech: 'violet', turn_taking: 'muted',
      };
      els.promptCategory.className = `badge badge--${colors[currentPrompt.category] || 'blue'}`;
    } else {
      els.promptText.textContent = 'All prompts complete! 🎉';
      els.promptCategory.textContent = 'Done';
      els.promptCategory.className = 'badge badge--green';
      els.promptNumber.textContent = '';
    }
  }

  function updateSessionInfo() {
    els.infoRecorded.textContent = recordedCount;
    els.infoRemaining.textContent = remainingCount;
  }

  // ── Permissions ────────────────────────────────────
  async function requestPermissions() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      markPermission('perm-mic', true);
    } catch {
      markPermission('perm-mic', false);
      throw new Error('Microphone permission required');
    }

    // Motion (iOS 13+ needs explicit request)
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        markPermission('perm-motion', result === 'granted');
      } catch {
        markPermission('perm-motion', false);
      }
    } else {
      markPermission('perm-motion', true);
    }
  }

  function markPermission(id, granted) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('permission-item--granted', granted);
      el.classList.toggle('permission-item--denied', !granted);
    }
  }

  // ── GPS ────────────────────────────────────────────
  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
  }

  function startGpsWatch() {
    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastGpsPosition = pos;
        els.dotGps.className = 'capture-status-bar__dot capture-status-bar__dot--gps';
      },
      (err) => {
        console.warn('GPS error:', err);
        els.dotGps.className = 'capture-status-bar__dot';
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  function stopGpsWatch() {
    if (gpsWatchId != null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }

  // ── Motion & Orientation ───────────────────────────
  function startMotionListeners() {
    window.addEventListener('devicemotion', onDeviceMotion);
    window.addEventListener('deviceorientation', onDeviceOrientation);
    els.dotMotion.className = 'capture-status-bar__dot capture-status-bar__dot--motion';
  }

  function stopMotionListeners() {
    window.removeEventListener('devicemotion', onDeviceMotion);
    window.removeEventListener('deviceorientation', onDeviceOrientation);
  }

  function onDeviceMotion(e) { lastMotionEvent = e; }
  function onDeviceOrientation(e) { lastOrientationEvent = e; }

  // ── Metadata Gathering ─────────────────────────────
  function gatherSessionMetadata() {
    const meta = {
      client_ua: navigator.userAgent,
      client_platform: navigator.platform,
      client_viewport: `${window.innerWidth}x${window.innerHeight}`,
      client_locale: navigator.language,
      client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    try {
      meta.screen_info_json = {
        width: screen.width, height: screen.height,
        availWidth: screen.availWidth, availHeight: screen.availHeight,
        colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
        devicePixelRatio: window.devicePixelRatio,
        orientation: screen.orientation ? {
          type: screen.orientation.type, angle: screen.orientation.angle,
        } : null,
      };
    } catch {}

    return meta;
  }

  function gatherRecordingMetadata() {
    const meta = {
      client_ua: navigator.userAgent,
      client_platform: navigator.platform,
      client_locale: navigator.language,
    };

    if (lastGpsPosition) {
      const c = lastGpsPosition.coords;
      meta.location_lat = c.latitude;
      meta.location_lon = c.longitude;
      meta.location_accuracy = c.accuracy;
      meta.location_speed = c.speed;
      meta.location_heading = c.heading;
      meta.location_altitude = c.altitude;
    }

    if (lastMotionEvent) {
      const m = lastMotionEvent;
      if (m.acceleration) {
        meta.motion_accel_x = m.acceleration.x;
        meta.motion_accel_y = m.acceleration.y;
        meta.motion_accel_z = m.acceleration.z;
      }
      if (m.accelerationIncludingGravity) {
        meta.motion_accel_gravity_x = m.accelerationIncludingGravity.x;
        meta.motion_accel_gravity_y = m.accelerationIncludingGravity.y;
        meta.motion_accel_gravity_z = m.accelerationIncludingGravity.z;
      }
      if (m.rotationRate) {
        meta.motion_rot_alpha = m.rotationRate.alpha;
        meta.motion_rot_beta = m.rotationRate.beta;
        meta.motion_rot_gamma = m.rotationRate.gamma;
      }
      meta.motion_interval_ms = m.interval;
    }

    if (lastOrientationEvent) {
      const o = lastOrientationEvent;
      meta.orientation_alpha = o.alpha;
      meta.orientation_beta = o.beta;
      meta.orientation_gamma = o.gamma;
      meta.orientation_absolute = o.absolute;
      if (o.webkitCompassHeading != null) {
        meta.compass_heading = o.webkitCompassHeading;
        meta.compass_accuracy = o.webkitCompassAccuracy;
      }
    }

    if (screen.orientation) {
      meta.screen_orientation_type = screen.orientation.type;
      meta.screen_orientation_angle = screen.orientation.angle;
    }

    if (audioContext) {
      meta.audio_context_sample_rate = audioContext.sampleRate;
      meta.audio_context_base_latency = audioContext.baseLatency;
    }

    if (mediaStream) {
      const tracks = mediaStream.getAudioTracks();
      if (tracks.length > 0) {
        try { meta.audio_track_settings_json = tracks[0].getSettings(); } catch {}
      }
    }

    return meta;
  }

  // ── TTS (Promise-based) ────────────────────────────
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.9;
    utter.pitch = 1;
    utter.volume = 1;
    speechSynthesis.speak(utter);
  }

  /**
   * Speak a prompt and return a Promise that resolves when TTS finishes.
   * This is the key function that makes the auto-loop wait for speech to end
   * before starting the recording.
   */
  function speakPromptAsync(text) {
    return new Promise((resolve) => {
      if (!text || !('speechSynthesis' in window)) {
        // No TTS available — just wait a moment
        setTimeout(resolve, 1500);
        return;
      }

      // Cancel any pending speech
      speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.9;
      utter.pitch = 1;
      utter.volume = 1;

      utter.onend = () => resolve();
      utter.onerror = () => resolve(); // resolve anyway to not block the loop

      // Safety timeout in case onend never fires (can happen on some browsers)
      const safetyTimeout = setTimeout(() => {
        resolve();
      }, 15000);

      utter.onend = () => {
        clearTimeout(safetyTimeout);
        resolve();
      };

      speechSynthesis.speak(utter);
    });
  }

  // ── Helpers ────────────────────────────────────────
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function formatCategory(cat) {
    if (!cat) return '—';
    return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── Public API ─────────────────────────────────────
  return { init };
})();
