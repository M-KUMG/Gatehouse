// The sound of an active buzzer: a quiet square wave at its 2.3 kHz oscillator
// pitch, on while any buzzer in the circuit is sounding. Purely audible, like
// the sound-wave drawing: nothing in the simulation depends on it.
//
// The part's overlay calls `markBuzzing(partId)` every frame it sounds. A timer
// fades the tone in while a mark is fresh and out when marks stop (the part
// was switched off, deleted, or the simulation paused). Browsers only allow
// audio after a user gesture, so the audio context is created on the first
// pointer press or key press anywhere on the page.

/** Pitch of the internal oscillator of the active buzzer, in hertz. */
export const BUZZER_HZ = 2300;
/** Loudness, 0..1 of full scale: a buzzer is meant to be noticed, not to hurt. */
const VOLUME = 0.05;
/** A mark older than this many milliseconds no longer counts as sounding. */
const FRESH_MS = 200;
const CHECK_MS = 60;

const marks = new Map<number, number>();
let muted = false;
let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let armed = false;

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | undefined {
  const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext;
}

function ensureAudio(): void {
  if (ctx) return;
  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    ctx = new Ctor();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = BUZZER_HZ;
    gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
  } catch {
    ctx = null;
    gain = null;
  }
}

/** The tone follows the marks: on while any is fresh. */
function update(): void {
  const now = performance.now();
  let on = false;
  for (const [id, t] of marks) {
    if (now - t > FRESH_MS) marks.delete(id);
    else on = true;
  }
  if (!ctx || !gain) return;
  if (on && !muted && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  gain.gain.setTargetAtTime(on && !muted ? VOLUME : 0, ctx.currentTime, 0.015);
}

function arm(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const start = (): void => {
    ensureAudio();
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', start, { capture: true });
  window.addEventListener('keydown', start, { capture: true });
}

/** A buzzer (by part id) sounds in this frame. */
export function markBuzzing(partId: number): void {
  arm();
  marks.set(partId, performance.now());
  if (timer === null) timer = setInterval(update, CHECK_MS);
  update();
}

/** Silence all buzzers without touching the circuit (a mute switch). */
export function setBuzzerMuted(value: boolean): void {
  muted = value;
  update();
}

export function isBuzzerMuted(): boolean {
  return muted;
}
