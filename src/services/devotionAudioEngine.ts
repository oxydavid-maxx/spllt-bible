import type { SpeechEngine, DevotionSpeechRequest } from './devotionSpeech';
export interface DevotionSegmentAudio {
  play(callbacks: Parameters<SpeechEngine['speak']>[1]): Promise<void>;
  setRate(rate: number): Promise<void>;
  dispose(): void;
}
/** One owned paragraph. A failed request/player switches only this paragraph to device speech. */
export function createDevotionAudioEngine({ device, loadAudio, timeoutMs = 8_000 }: {
  device: SpeechEngine;
  loadAudio: (request: DevotionSpeechRequest, signal: AbortSignal) => Promise<DevotionSegmentAudio>;
  timeoutMs?: number;
}): SpeechEngine {
  let cancel: (() => void) | undefined;
  let changeRate: ((rate: number) => void) | undefined;
  function stop() { cancel?.(); cancel = undefined; changeRate = undefined; device.stop(); }
  return {
    stop,
    setRate: rate => changeRate?.(rate),
    speak(text, callbacks, request) {
      stop();
      if (!request) { device.speak(text, callbacks); return; }
      const context = { ...request };
      const controller = new AbortController();
      let active = true, mode: 'remote' | 'device' = 'remote', deviceAttempt = 0;
      let audio: DevotionSegmentAudio | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
      const dispose = () => { const previous = audio; audio = undefined; previous?.dispose(); };
      const finish = (kind: 'onDone' | 'onError' | 'onStopped') => {
        if (!active) return;
        active = false; clearTimer(); controller.abort(); dispose(); callbacks[kind]();
      };
      function speakDevice() {
        const attempt = ++deviceAttempt;
        device.speak(text, {
          onDone: () => { if (attempt === deviceAttempt) finish('onDone'); },
          onError: () => { if (attempt === deviceAttempt) finish('onError'); },
          onStopped: () => { if (attempt === deviceAttempt) finish('onStopped'); },
        }, { ...context });
      }
      function fallback() {
        if (!active || mode === 'device') return;
        mode = 'device'; clearTimer(); controller.abort(); dispose();
        // Device speech reports no position: the screen lights the whole paragraph again.
        callbacks.onProgress?.(null);
        try { speakDevice(); } catch { finish('onError'); }
      }
      cancel = () => { active = false; deviceAttempt++; clearTimer(); controller.abort(); dispose(); };
      changeRate = rate => {
        if (!active || !(rate > 0)) return;
        context.rate = rate;
        if (mode === 'remote') { void audio?.setRate(rate).catch(fallback); }
        else { deviceAttempt++; device.stop(); try { speakDevice(); } catch { finish('onError'); } }
      };
      timer = setTimeout(fallback, timeoutMs);
      void (async () => {
        try {
          const loaded = await loadAudio(context, controller.signal);
          if (!active || mode !== 'remote') { loaded.dispose(); return; }
          audio = loaded;
          await loaded.setRate(context.rate);
          if (!active || mode !== 'remote') return;
          await loaded.play({
            onDone: () => { if (mode === 'remote') finish('onDone'); },
            onError: fallback,
            onStopped: () => { if (mode === 'remote') finish('onStopped'); },
            onProgress: (share) => { if (active && mode === 'remote') callbacks.onProgress?.(share); },
          });
          clearTimer();
        } catch { fallback(); }
      })();
    },
  };
}
