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
  let recordingTimerInterval = null;
  let recordingDurationMs = 10000; // 10 seconds
  let cancelCurrentRecording = null; // function to cancel active recording

  // TTS
  const hasSpeech = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  let speechUnlocked = false;
  const speechVoicesReady = hasSpeech ? waitForSpeechVoices() : Promise.resolve();

  // Wake Lock
  let wakeLock = null;

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
     THE AUTO-LOOP — Core hands-free cycle (linear while-loop)

     1. Show prompt on screen
     2. Speak prompt via TTS (wait for it to finish)
     3. Record for 10s
     4. Upload + save metadata
     5. Advance to next prompt
     6. Repeat from step 1
     ═══════════════════════════════════════════════════ */

  async function runPromptLoop() {
    while (sessionActive && currentPrompt && commuteId) {
      // Wait while paused
      while (isPaused && sessionActive) {
        await delay(200);
      }
      if (!sessionActive || !currentPrompt) break;

      try {
        // ① Show prompt
        updatePromptDisplay();
        setRingState('speaking');

        // ② Speak prompt and wait for TTS to finish
        await speakPromptAsync(currentPrompt.text);
        if (!sessionActive || isPaused) continue;

        // ③ Get presigned upload URL
        setRingState('preparing');
        const uploadInfo = await api.getUploadUrl({
          commute_id: commuteId,
          prompt_id: currentPrompt.id,
          content_type: wavRecorder.MIME_TYPE,
        });
        if (!sessionActive || isPaused) continue;

        // ④ Record for 10 seconds
        const recordResult = await recordAudio();
        if (!sessionActive || !recordResult) continue;

        // ⑤ Upload to MinIO
        setRingState('uploading');
        const uploadResp = await fetch(uploadInfo.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': wavRecorder.MIME_TYPE },
          body: recordResult.blob,
        });
        if (!uploadResp.ok) {
          throw new Error(`Upload failed: HTTP ${uploadResp.status}`);
        }
        if (!sessionActive) break;

        // ⑥ Notify backend
        const captureStartedAt = new Date(Date.now() - recordResult.durationMs).toISOString();
        const captureEndedAt = new Date().toISOString();
        const sensorData = gatherRecordingMetadata();

        const result = await api.createRecording({
          commute_id: commuteId,
          prompt_id: currentPrompt.id,
          object_url: uploadInfo.object_url,
          object_key: uploadInfo.object_key,
          duration_ms: recordResult.durationMs,
          capture_started_at: captureStartedAt,
          capture_ended_at: captureEndedAt,
          upload_completed_at: new Date().toISOString(),
          file_size_bytes: recordResult.blob.size,
          content_type: wavRecorder.MIME_TYPE,
          ...sensorData,
        });

        // ⑦ Advance to next prompt
        recordedCount++;
        currentPrompt = result.next_prompt;
        remainingCount = result.remaining_count;
        updatePromptDisplay();
        updateSessionInfo();
        toast.success(`Clip #${recordedCount} uploaded ✓`);

        // Cooldown before next prompt
        setRingState('uploaded');
        await delay(2000);

      } catch (err) {
        console.error('Prompt cycle error:', err);
        toast.error(`Error: ${err.message}`);
        // Pause on error instead of silently retrying
        isPaused = true;
        updatePauseButton();
        setRingState('paused');
        toast.info('Paused due to error — tap play to retry');
      }
    }

    if (!currentPrompt && sessionActive) {
      speakPromptAsync('All prompts have been recorded. Great session!');
      toast.info('All prompts recorded! 🎉');
      setRingState('done');
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

      // Unlock TTS on iOS Safari — must happen in direct user gesture handler
      unlockSpeechSynthesis();

      // Request motion permission immediately in user gesture (iOS requires this)
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          const motionResult = await DeviceMotionEvent.requestPermission();
          markPermission('perm-motion', motionResult === 'granted');
        } catch {
          markPermission('perm-motion', false);
        }
      } else {
        markPermission('perm-motion', true);
      }

      // Wait for WAV encoder to be ready
      await wavRecorder.ready();

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

      // Keep screen on
      await requestWakeLock();

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
      runPromptLoop();

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
      if (isRecording && cancelCurrentRecording) {
        cancelCurrentRecording();
      }

      // Cancel any pending TTS
      if (hasSpeech) {
        speechSynthesis.cancel();
      }

      await api.endCommute(commuteId);

      // Cleanup
      releaseWakeLock();
      stopGpsWatch();
      stopMotionListeners();
      clearInterval(sessionDurationInterval);

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
      // Resume — the while loop in runPromptLoop will pick up automatically
      isPaused = false;
      updatePauseButton();
      toast.info('Resumed — next prompt coming up');

      if (hasSpeech) {
        speechSynthesis.cancel();
      }
    } else {
      // Pause
      isPaused = true;
      updatePauseButton();

      // Stop any in-progress recording
      if (isRecording && cancelCurrentRecording) {
        cancelCurrentRecording();
      }

      // Cancel TTS
      if (hasSpeech) {
        speechSynthesis.cancel();
      }

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
    if (isRecording && cancelCurrentRecording) {
      cancelCurrentRecording();
    }

    // Cancel TTS
    if (hasSpeech) {
      speechSynthesis.cancel();
    }

    toast.info('Skipped — re-reading prompt');
  }

  // ── Record Audio (returns Promise<{ blob, durationMs } | null>) ──
  async function recordAudio() {
    if (!currentPrompt || !commuteId) {
      throw new Error('No prompt or commute');
    }

    isRecording = true;
    setRingState('recording');
    els.dotMic.className = 'capture-status-bar__dot capture-status-bar__dot--mic';

    // Start countdown timer UI
    startRecordingTimer();

    const result = await wavRecorder.record(mediaStream, recordingDurationMs, {
      onTick: (elapsed) => {
        const remaining = Math.max(0, recordingDurationMs - elapsed);
        els.ringTimer.textContent = (remaining / 1000).toFixed(1);
        updateRingProgress(elapsed / recordingDurationMs);
        if (analyserNode && isRecording) updateWaveform();
      },
      onCancel: (cancelFn) => {
        cancelCurrentRecording = () => {
          cancelFn();
          isRecording = false;
          clearInterval(recordingTimerInterval);
          cancelCurrentRecording = null;
          setRingState('ready');
          resetWaveform();
        };
      },
    });

    isRecording = false;
    clearInterval(recordingTimerInterval);
    cancelCurrentRecording = null;
    resetWaveform();

    return result; // null if cancelled
  }

  // ── Recording Timer (kept for waveform updates if onTick not used) ──
  function startRecordingTimer() {
    // Timer UI is now handled by wavRecorder.onTick callback
    // This is a placeholder in case other code references it
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

  // ── TTS ─────────────────────────────────────────────
  function unlockSpeechSynthesis() {
    if (speechUnlocked || !hasSpeech) return;
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    speechSynthesis.speak(utterance);
    speechUnlocked = true;
  }

  function waitForSpeechVoices(timeoutMs = 1500) {
    if (!hasSpeech) return Promise.resolve();
    if (speechSynthesis.getVoices().length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      let timerId = null;
      const finalize = () => {
        if (settled) return;
        settled = true;
        speechSynthesis.removeEventListener('voiceschanged', handleVoiceChange);
        if (timerId) clearTimeout(timerId);
        resolve();
      };
      function handleVoiceChange() { finalize(); }
      timerId = setTimeout(finalize, timeoutMs);
      speechSynthesis.addEventListener('voiceschanged', handleVoiceChange, { once: true });
      speechSynthesis.getVoices();
    });
  }

  function speak(text) {
    if (!hasSpeech) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.9;
    utter.pitch = 1;
    utter.volume = 1;
    speechSynthesis.speak(utter);
  }

  function speakPromptAsync(text) {
    if (!text || !hasSpeech) {
      return delay(1500);
    }
    return speechVoicesReady.then(
      () =>
        new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 0.9;
          utterance.pitch = 1;
          utterance.volume = 1;
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          speechSynthesis.cancel();
          speechSynthesis.speak(utterance);
          // Safety timeout
          setTimeout(resolve, 15000);
        }),
    );
  }

  // ── Wake Lock ──────────────────────────────────────
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
        document.addEventListener('visibilitychange', reacquireWakeLock);
      } catch (err) {
        console.warn('Wake lock request failed:', err);
      }
    }
  }

  async function reacquireWakeLock() {
    if (document.visibilityState === 'visible' && sessionActive && !wakeLock) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } catch {}
    }
  }

  function releaseWakeLock() {
    document.removeEventListener('visibilitychange', reacquireWakeLock);
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  }

  // ── Helpers ────────────────────────────────────────
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
