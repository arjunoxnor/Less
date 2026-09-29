/**
 * Playing a note back. One player for the whole app, so starting one note
 * stops another. A recording this device still holds plays from here;
 * everything else plays from the server, which answers byte ranges so the
 * browser can seek.
 *
 * togglePlay is synchronous on purpose: Safari only lets audio start inside
 * the click itself, so the source must be known without waiting on storage.
 * The cards tell the player about local recordings as they find them.
 */

export interface PlayerState {
  id: string | null;
  playing: boolean;
  /** Seconds. */
  position: number;
  duration: number;
  error: string | null;
}

let audio: HTMLAudioElement | null = null;
let state: PlayerState = { id: null, playing: false, position: 0, duration: 0, error: null };
const listeners = new Set<() => void>();

/** Recordings held on this device, by note id. Kept for the page's life:
 *  one stays playable from here even after it has uploaded. */
const localUrls = new Map<string, string>();

export function rememberLocalRecording(id: string, blob: Blob): void {
  if (localUrls.has(id) || typeof URL.createObjectURL !== "function") return;
  localUrls.set(id, URL.createObjectURL(blob));
}

function emit(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function playerState(): PlayerState {
  return state;
}

export function subscribePlayer(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";
  audio.addEventListener("timeupdate", () => emit({ position: audio!.currentTime }));
  audio.addEventListener("durationchange", () => {
    const d = audio!.duration;
    if (Number.isFinite(d)) emit({ duration: d });
  });
  audio.addEventListener("play", () => emit({ playing: true, error: null }));
  audio.addEventListener("pause", () => emit({ playing: false }));
  audio.addEventListener("ended", () => emit({ playing: false, position: 0 }));
  audio.addEventListener("error", () => {
    if (!state.id) return;
    emit({ playing: false, error: "This recording is not available yet." });
  });
  return audio;
}

/** A failed start keeps the more specific reason if the element gave one. */
const couldNotPlay = () => emit({ playing: false, error: state.error ?? "Could not play the recording." });

/** Play `id` from the start, or pause/resume it if it is the current one. */
export function togglePlay(id: string, knownDurationMs = 0): void {
  const el = element();
  if (state.id === id) {
    if (el.paused) void el.play().catch(couldNotPlay);
    else el.pause();
    return;
  }
  el.pause();
  emit({ id, playing: false, position: 0, duration: knownDurationMs / 1000, error: null });
  el.src = localUrls.get(id) ?? `/api/assets/${id}`;
  void el.play().catch(couldNotPlay);
}

export function stopPlayback(): void {
  audio?.pause();
  emit({ id: null, playing: false, position: 0, duration: 0, error: null });
}
