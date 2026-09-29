/**
 * The shape of a recording, as bars.
 *
 * While recording, the level is sampled many times a second. The bar at the
 * top of the screen shows the WHOLE recording so far: until it is full, each
 * sample is one bar and the bar grows from the left; once there are more
 * samples than room, neighbouring samples merge, so the whole note squeezes
 * to fit and nothing scrolls away. A finished note keeps
 * a short summary of the same shape, stored in the document as a few dozen
 * characters, so its card can draw it without the audio.
 */

/**
 * Fit `samples` (0..1) into at most `width` bars. A merged bar is half its
 * loudest moment and half its average: peaks alone would push every bar of a
 * long talk to the top, and averages alone would flatten short words away.
 * This way a long note still shows where the talking was and where the pauses.
 */
export function compressPeaks(samples: readonly number[], width: number): number[] {
  const bars = Math.max(0, Math.floor(width));
  if (bars === 0) return [];
  if (samples.length <= bars) return samples.slice();
  const out: number[] = new Array(bars);
  const per = samples.length / bars;
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * per);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((i + 1) * per)));
    let peak = 0;
    let sum = 0;
    for (let j = from; j < to; j++) {
      const v = samples[j];
      if (v > peak) peak = v;
      sum += v;
    }
    out[i] = (peak + sum / (to - from)) / 2;
  }
  return out;
}

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
/** How many bars a stored summary holds. */
export const SUMMARY_BARS = 48;

/** A recording's shape as a short string: one base-36 digit per bar. */
export function encodePeaks(samples: readonly number[], bars = SUMMARY_BARS): string {
  if (samples.length === 0) return "";
  // A summary has exactly `bars` bars: a short note is stretched to fill them.
  const fitted =
    samples.length >= bars
      ? compressPeaks(samples, bars)
      : Array.from({ length: bars }, (_, i) => samples[Math.floor((i * samples.length) / bars)]);
  return fitted
    .map((v) => DIGITS[Math.max(0, Math.min(35, Math.round(Math.max(0, Math.min(1, v)) * 35)))])
    .join("");
}

/** The bars of a stored summary, 0..1. Anything unreadable reads as silence. */
export function decodePeaks(summary: unknown): number[] {
  if (typeof summary !== "string") return [];
  return [...summary.toLowerCase()].map((ch) => {
    const n = DIGITS.indexOf(ch);
    return n < 0 ? 0 : n / 35;
  });
}

/**
 * A level (0..1) from one frame of time-domain samples (-1..1): the RMS,
 * lifted so ordinary speech fills most of the bar's height the way Voice
 * Memos draws it.
 */
export function levelOf(frame: ArrayLike<number>): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / frame.length);
  return Math.max(0, Math.min(1, Math.pow(rms * 4, 0.7)));
}

/** "0:07", "4:32", "1:02:05". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
