/* ═══════════════════════════════════════════════════════
   WAV Recorder — True WAV recording via extendable-media-recorder
   Loaded as ES module, exposes factory on window.
   ═══════════════════════════════════════════════════════ */

import { MediaRecorder as ExtendableMediaRecorder, register } from "https://cdn.jsdelivr.net/npm/extendable-media-recorder@9/+esm";
import { connect as connectWav } from "https://cdn.jsdelivr.net/npm/extendable-media-recorder-wav-encoder@7.0.128/+esm";

const MIME_TYPE = "audio/wav";

const wavReady = (async () => {
  try {
    await register(await connectWav());
  } catch (error) {
    console.error("Unable to initialize WAV encoder", error);
    throw new Error("This browser cannot initialize WAV recording.");
  }
})();

window.wavRecorder = {
  MIME_TYPE,

  async ready() {
    await wavReady;
  },

  /**
   * Record audio from the given stream for `durationMs` milliseconds.
   * Returns a Promise<{ blob, durationMs }>.
   * If `onTick` is provided, it's called every 50ms with elapsed ms.
   */
  record(stream, durationMs, { onTick, onCancel } = {}) {
    return new Promise((resolve, reject) => {
      try {
        const chunks = [];
        const recorder = new ExtendableMediaRecorder(stream, { mimeType: MIME_TYPE });
        let cancelled = false;
        let tickInterval = null;
        const startTime = Date.now();

        if (onCancel) {
          onCancel(() => {
            cancelled = true;
            if (tickInterval) clearInterval(tickInterval);
            if (recorder.state === "recording") {
              recorder.ondataavailable = null;
              recorder.onstop = null;
              try { recorder.stop(); } catch {}
            }
            resolve(null);
          });
        }

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onerror = (e) => {
          if (tickInterval) clearInterval(tickInterval);
          reject(e.error || new Error("Recording error"));
        };

        recorder.onstop = () => {
          if (tickInterval) clearInterval(tickInterval);
          if (cancelled) return;
          const blob = new Blob(chunks, { type: MIME_TYPE });
          resolve({ blob, durationMs: Date.now() - startTime });
        };

        recorder.start();

        if (onTick) {
          tickInterval = setInterval(() => {
            onTick(Date.now() - startTime);
          }, 50);
        }

        setTimeout(() => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, durationMs);
      } catch (err) {
        reject(err);
      }
    });
  },
};
