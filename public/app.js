// app.js
// Modern PWA flow for CommuteCapture

const state = {
  sessionId: null,
  isRecording: false,
  currentPromptIndex: 0,
  prompts: [
    { text: "Turn on the defroster", category: "short_command" },
    { text: "What's the weather like in Seattle right now?", category: "free_form" },
    { text: "Navigate to 123 Main Street", category: "task_oriented" },
    { text: "Play my driving playlist", category: "short_command" },
    { text: "Describe the traffic ahead.", category: "free_form" }
  ],
  timerInterval: null,
  recordingDurationMs: 10000,
  cooldownDurationMs: 3000
};

// DOM Elements
const els = {
  viewLanding: document.getElementById('view-landing'),
  viewCapture: document.getElementById('view-capture'),
  btnStart: document.getElementById('btn-start'),
  btnEnd: document.getElementById('btn-end'),
  promptText: document.getElementById('prompt-text'),
  promptCategory: document.getElementById('prompt-category'),
  actionText: document.getElementById('action-text'),
  statusText: document.getElementById('status-text'),
  statusDot: document.getElementById('status-dot'),
  progressRing: document.getElementById('progress-ring'),
  micIcon: document.getElementById('mic-icon'),
  micSvg: document.getElementById('mic-svg')
};

// Utility to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// UI updates
const setStatus = (status, colorClass) => {
  els.statusText.textContent = status;
  els.statusDot.className = `w-2 h-2 rounded-full ${colorClass}`;
};

const switchView = (from, to) => {
  from.classList.add('opacity-0');
  setTimeout(() => {
    from.classList.add('hidden');
    to.classList.remove('hidden');
    // slight delay for transition
    setTimeout(() => {
      to.classList.remove('opacity-0');
    }, 50);
  }, 300);
};

const updateProgress = (percent) => {
  const offset = 283 - (percent / 100) * 283;
  els.progressRing.style.strokeDashoffset = offset;
};

// Initialize
function init() {
  console.log("CommuteCapture UI initialized.");

  els.btnStart.addEventListener('click', startCommute);
  els.btnEnd.addEventListener('click', endCommute);
}

// Session Management
async function startCommute() {
  console.log("Starting commute session...");

  // Update UI for loading state
  els.btnStart.innerHTML = `
    <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Connecting...
  `;
  els.btnStart.disabled = true;

  // Simulate API call to POST /v1/commutes
  await wait(1000);

  // Set Session ID
  state.sessionId = 'com_' + Math.random().toString(36).substring(2, 9);
  state.currentPromptIndex = 0;

  // Transition UI
  switchView(els.viewLanding, els.viewCapture);
  setStatus('Session Active', 'bg-green-500');

  // Start the prompt loop
  startPromptLoop();
}

async function endCommute() {
  console.log("Ending commute session...");

  // Stop recording/loop
  state.isRecording = false;
  if (state.timerInterval) clearInterval(state.timerInterval);

  // Simulate API call to PATCH /v1/commutes/{id}
  await wait(500);

  // Reset state
  state.sessionId = null;
  state.currentPromptIndex = 0;

  // Reset UI
  updateProgress(0);
  els.micIcon.classList.remove('bg-red-500', 'animate-recording');
  els.micIcon.classList.add('bg-gray-700');
  els.micSvg.classList.remove('text-white');
  els.micSvg.classList.add('text-gray-400');
  els.actionText.textContent = "Session Ended";

  setStatus('Ready', 'bg-gray-500');

  // Reset start button
  els.btnStart.innerHTML = 'Start Commute';
  els.btnStart.disabled = false;

  // Transition UI
  switchView(els.viewCapture, els.viewLanding);
}

// Mock Prompt Loop
async function startPromptLoop() {
  console.log("Prompt loop started");

  while (state.sessionId !== null) { // run until session ends
    const prompt = state.prompts[state.currentPromptIndex % state.prompts.length];

    // Display prompt
    els.promptCategory.textContent = prompt.category.replace('_', ' ');
    els.promptText.textContent = `"${prompt.text}"`;

    // Preparation phase
    els.actionText.textContent = "Get ready...";
    els.micIcon.classList.remove('bg-red-500', 'animate-recording');
    els.micIcon.classList.add('bg-gray-700');
    els.micSvg.classList.remove('text-white');
    els.micSvg.classList.add('text-gray-400');
    setStatus('Buffering', 'bg-yellow-500');
    updateProgress(0);

    await wait(2000);
    if (!state.sessionId) break; // User ended early

    // Recording phase
    state.isRecording = true;
    els.actionText.textContent = "Recording...";
    els.micIcon.classList.remove('bg-gray-700');
    els.micIcon.classList.add('bg-red-500', 'animate-recording');
    els.micSvg.classList.remove('text-gray-400');
    els.micSvg.classList.add('text-white');
    setStatus('Recording', 'bg-red-500');

    // Simulate 10-second timer UI update
    let start = Date.now();
    state.timerInterval = setInterval(() => {
      let elapsed = Date.now() - start;
      let percent = (elapsed / state.recordingDurationMs) * 100;
      if (percent >= 100) percent = 100;
      updateProgress(percent);
    }, 50);

    // Wait for 10s recording
    await wait(state.recordingDurationMs);
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.isRecording = false;

    if (!state.sessionId) break; // User ended early

    // Upload phase
    els.actionText.textContent = "Uploading...";
    els.micIcon.classList.remove('animate-recording', 'bg-red-500');
    els.micIcon.classList.add('bg-blue-600');
    setStatus('Syncing', 'bg-blue-500');

    await wait(1500); // Simulate network latency for upload + metadata sync

    if (!state.sessionId) break;

    // Advance to next prompt
    state.currentPromptIndex++;

    // Cooldown phase
    els.actionText.textContent = "Next prompt soon...";
    els.micIcon.classList.remove('bg-blue-600');
    els.micIcon.classList.add('bg-gray-700');
    els.micSvg.classList.remove('text-white');
    els.micSvg.classList.add('text-gray-400');
    setStatus('Cooldown', 'bg-green-400');
    updateProgress(0);

    await wait(state.cooldownDurationMs);
  }
}

init();