"use client";

// Loud, repeating alert sound generated with Web Audio (no audio files to cache or lose offline).
// Browsers only allow sound after a tap, so the counter taps "Start shift" once.

let ctx: AudioContext | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;

export function unlockAudio(): boolean {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    // A silent blip to finish the unlock on Safari.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
    return true;
  } catch {
    return false;
  }
}

export const audioReady = () => !!ctx && ctx.state === "running";

/** Two-tone alarm burst. kind "urgent" is louder and longer. */
export function beep(kind: "urgent" | "soft" = "urgent") {
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const tones = kind === "urgent" ? [880, 1320, 880, 1320] : [660, 990];
  tones.forEach((f, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = "square";
    o.frequency.value = f;
    const t = now + i * 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kind === "urgent" ? 0.9 : 0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(ctx!.destination);
    o.start(t);
    o.stop(t + 0.21);
  });
}

export async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock && !wakeLock) {
      wakeLock = await nav.wakeLock.request("screen");
      document.addEventListener(
        "visibilitychange",
        async () => {
          if (document.visibilityState === "visible" && nav.wakeLock) {
            try {
              wakeLock = await nav.wakeLock.request("screen");
            } catch {}
          }
        },
        { once: false },
      );
    }
  } catch {}
}
