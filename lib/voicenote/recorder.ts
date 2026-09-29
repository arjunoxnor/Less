import { levelOf } from "./waveform";
import { forgetRecording, keepRecording, saveChunk } from "./localAudio";

/**
 * Recording a voice note in the browser.
 *
 * The browser's own recorder (MediaRecorder) does the work: every browser LESS
 * runs in has one, including Safari on a phone, unlike speech recognition,
 * which most of them lack. Speech needs little: mono at 32 kbps is clear and
 * keeps an hour under 15 MB. Each second of audio is handed to the device's
 * storage as it arrives (localAudio.ts), and the microphone level is sampled
 * twenty times a second for the waveform.
 */

/** Ids being recorded in this tab right now, so recovery never touches them. */
export const activeRecordings = new Set<string>();

/**
 * While a note records, its tab holds a lock by this name. The browser drops it
 * the moment the tab closes or crashes, so another tab can tell a note that is
 * still being recorded (perhaps paused) from one that was cut off.
 */
const lockName = (id: string) => `less-voice:${id}`;

/** True: being recorded right now, here or in another tab. False: nobody is.
 *  Null: this browser cannot say (it has no Web Locks). */
export async function isRecordingElsewhere(id: string): Promise<boolean | null> {
  if (activeRecordings.has(id)) return true;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.query) return null;
  try {
    const state = await locks.query();
    return (state.held ?? []).some((lock) => lock.name === lockName(id));
  } catch {
    return null;
  }
}

/**
 * The server keeps a recording of up to 24 MB. A recording stops itself a
 * little before that, so it always fits. At the 32 kbps asked for, that is
 * about an hour and a half; a browser that ignores the request and records
 * richer audio reaches it sooner.
 */
export const RECORDING_BYTE_LIMIT = 23 * 1024 * 1024;

export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** A fresh id for a note: 128 random bits, the same shape as an asset id. */
export function newVoiceId(): string {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The first format this browser records in: Opus in WebM or Ogg, else AAC in MP4 (Safari). */
function pickMime(): string {
  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  for (const mime of options) {
    try {
      if (MediaRecorder.isTypeSupported?.(mime)) return mime;
    } catch {
      /* keep looking */
    }
  }
  return "";
}

/** A sentence for the writer, from whatever the browser threw. */
export function micErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is blocked for this site. Allow it in the browser's site settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found.";
  }
  if (name === "NotReadableError") {
    return "The microphone is in use by another app.";
  }
  return "Recording could not start.";
}

export interface FinishedRecording {
  blob: Blob;
  mime: string;
  durationMs: number;
  /** Levels, twenty a second, 0..1, for the waveform summary. */
  samples: number[];
}

const SAMPLE_MS = 50;

/** The audio context that measures the level for the waveform. */
function makeContext(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctx ? new Ctx() : null;
  } catch {
    return null;
  }
}

export class VoiceRecording {
  readonly id: string;
  readonly mime: string;
  /** When the microphone opened. */
  readonly recordedAt = new Date().toISOString();
  /** Levels so far, twenty a second. Read by the recording bar. */
  readonly samples: number[] = [];
  private stream: MediaStream;
  private recorder: MediaRecorder;
  private context: AudioContext | null;
  private analyser: AnalyserNode | null;
  private frame: Float32Array<ArrayBuffer>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chunks: Blob[] = [];
  private seq = 0;
  private startedAt = Date.now();
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private listeners = new Set<() => void>();
  private bytes = 0;
  private unlock: (() => void) | null = null;
  private released = false;
  /** Set when the recording is about to outgrow what the server stores. */
  onFull: (() => void) | null = null;
  /** Set when the microphone goes away mid-note (a phone call, another app,
   *  a headset unplugged): what was recorded is still worth keeping. */
  onEnded: (() => void) | null = null;

  private constructor(
    id: string,
    stream: MediaStream,
    recorder: MediaRecorder,
    mime: string,
    context: AudioContext | null
  ) {
    this.id = id;
    this.stream = stream;
    this.recorder = recorder;
    this.mime = mime;
    let analyser: AnalyserNode | null = null;
    try {
      if (context) {
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
      }
    } catch {
      analyser = null;
    }
    this.context = context;
    this.analyser = analyser;
    this.frame = new Float32Array(new ArrayBuffer((analyser?.fftSize ?? 1024) * 4));
  }

  /**
   * Ask for the microphone and start. Throws a sentence fit for the writer.
   * Call it straight from the click: the audio context is made before the
   * permission prompt, while the click still counts as the writer's gesture.
   * Safari and Firefox will not run one made after it, and the waveform
   * would stay flat (the recording itself would be fine).
   */
  static async start(id: string): Promise<VoiceRecording> {
    const context = makeContext();
    void context?.resume?.().catch(() => {});
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error) {
      void context?.close?.().catch(() => {});
      throw new Error(micErrorMessage(error));
    }
    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 32_000,
      });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      void context?.close?.().catch(() => {});
      throw new Error("This browser cannot record audio.");
    }
    const rec = new VoiceRecording(id, stream, recorder, recorder.mimeType || mime || "audio/webm", context);
    rec.begin();
    return rec;
  }

  private begin() {
    activeRecordings.add(this.id);
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks?.request) {
      void locks
        .request(
          lockName(this.id),
          () =>
            new Promise<void>((resolve) => {
              if (this.released) resolve();
              else this.unlock = resolve;
            })
        )
        .catch(() => {});
    }
    this.recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      this.chunks.push(event.data);
      this.bytes += event.data.size;
      void saveChunk(this.id, this.seq++, event.data, this.mime);
      if (this.bytes >= RECORDING_BYTE_LIMIT && this.onFull) {
        const full = this.onFull;
        this.onFull = null;
        full();
      }
    };
    const ended = () => {
      if (this.released || !this.onEnded) return;
      const handler = this.onEnded;
      this.onEnded = null;
      handler();
    };
    this.stream.getAudioTracks().forEach((track) => track.addEventListener("ended", ended));
    this.recorder.onerror = ended;
    this.recorder.start(1000);
    void this.context?.resume?.().catch(() => {});
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.sample(), SAMPLE_MS);
  }

  private sample() {
    if (this.pausedAt !== null) return;
    let level = 0;
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.frame);
      level = levelOf(this.frame);
    }
    this.samples.push(level);
    this.listeners.forEach((fn) => fn());
  }

  /** Called on every new sample: the bar redraws. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** Time recorded, not counting pauses. */
  elapsedMs(): number {
    const now = this.pausedAt ?? Date.now();
    return Math.max(0, now - this.startedAt - this.pausedTotal);
  }

  pause() {
    if (this.pausedAt !== null || this.recorder.state !== "recording") return;
    this.recorder.pause();
    this.pausedAt = Date.now();
    this.listeners.forEach((fn) => fn());
  }

  resume() {
    if (this.pausedAt === null) return;
    this.recorder.resume();
    void this.context?.resume?.().catch(() => {});
    this.pausedTotal += Date.now() - this.pausedAt;
    this.pausedAt = null;
    this.listeners.forEach((fn) => fn());
  }

  private release() {
    this.released = true;
    this.unlock?.();
    this.unlock = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream.getTracks().forEach((t) => t.stop());
    void this.context?.close?.().catch(() => {});
    activeRecordings.delete(this.id);
    this.listeners.clear();
  }

  /**
   * Finish: the whole recording as one file, kept on this device until it
   * uploads. The note stays marked as recording (in this tab and to other
   * tabs) until it is kept, so nothing mistakes it for a cut-off note.
   */
  stop(): Promise<FinishedRecording> {
    const durationMs = this.elapsedMs();
    return new Promise((resolve) => {
      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        const blob = new Blob(this.chunks, { type: this.mime });
        await keepRecording({
          id: this.id,
          blob,
          mime: this.mime,
          durationMs,
          createdAt: new Date().toISOString(),
        });
        const samples = this.samples.slice();
        this.release();
        resolve({ blob, mime: this.mime, durationMs, samples });
      };
      if (this.recorder.state === "inactive") return void finish();
      this.recorder.onstop = () => void finish();
      try {
        this.recorder.stop();
      } catch {
        void finish();
      }
    });
  }

  /** Throw the recording away, pieces and all. */
  cancel() {
    try {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      if (this.recorder.state !== "inactive") this.recorder.stop();
    } catch {
      /* already stopped */
    }
    // The microphone goes off now; the note stays claimed until its pieces
    // are gone, so another tab cannot rescue what was thrown away.
    this.stream.getTracks().forEach((t) => t.stop());
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void forgetRecording(this.id).finally(() => this.release());
  }
}
