"use client";

import { useEffect, useRef, useState } from "react";
import { compressPeaks, formatDuration } from "@/lib/voicenote/waveform";
import type { VoiceRecording } from "@/lib/voicenote/recorder";

/**
 * The bar across the top of the page while a voice note records.
 *
 * The waveform shows the whole recording so far. It grows from the left one
 * bar per twentieth of a second; once it reaches the right edge it never
 * scrolls, it squeezes: every bar stands for a longer stretch, so a minute and
 * an hour both fit, and the pauses stay visible (lib/voicenote/waveform.ts).
 */

/** One bar and its gap, in CSS pixels. */
const PITCH = 4;
const BAR_W = 2;

function MicGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5zM3.5 7.5a.75.75 0 0 1 1.5 0 3 3 0 0 0 6 0 .75.75 0 0 1 1.5 0 4.5 4.5 0 0 1-3.75 4.44V13.5h1.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5h1.5v-1.56A4.5 4.5 0 0 1 3.5 7.5z"
      />
    </svg>
  );
}
export { MicGlyph };

function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M4.5 3h2.2v10H4.5zM9.3 3h2.2v10H9.3z" />
    </svg>
  );
}

function ResumeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" fill="currentColor" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.8 4.2h10.4M6.3 4.2V2.8h3.4v1.4M4.2 4.2l.6 8.6c0 .5.4.9.9.9h4.6c.5 0 .9-.4.9-.9l.6-8.6"
      />
    </svg>
  );
}

export function RecordingBar({
  rec,
  onDone,
  onDiscard,
}: {
  rec: VoiceRecording;
  onDone: () => void;
  onDiscard: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(rec.paused);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const draw = () => {
      frame = 0;
      const ctx = canvas.getContext("2d");
      if (!ctx || width <= 0 || height <= 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const slots = Math.max(1, Math.floor(width / PITCH));
      const bars = compressPeaks(rec.samples, slots);
      const style = getComputedStyle(canvas);
      const mid = height / 2;
      // The room still to fill: a faint dotted line, the way Voice Memos
      // shows where the recording will go.
      ctx.fillStyle = style.getPropertyValue("--rec-rest").trim() || "rgba(128,128,128,0.35)";
      for (let i = bars.length; i < slots; i++) ctx.fillRect(i * PITCH, mid - 0.5, BAR_W, 1);
      ctx.fillStyle = style.color;
      for (let i = 0; i < bars.length; i++) {
        const h = Math.max(2, Math.min(height, bars[i] * (height - 2)));
        ctx.fillRect(i * PITCH, mid - h / 2, BAR_W, h);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      draw();
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    const unsubscribe = rec.subscribe(() => {
      schedule();
      setPaused(rec.paused);
    });
    resize();
    return () => {
      observer?.disconnect();
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
    // The canvas is a new element after the discard question closes.
  }, [rec, confirming]);

  // The clock ticks on its own: a quiet room still counts.
  useEffect(() => {
    const tick = () => setSeconds(Math.floor(rec.elapsedMs() / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [rec]);

  return (
    <div className={"rec-bar" + (paused ? " rec-paused" : "")} role="region" aria-label="Voice recording">
      <div className="rec-inner">
        {confirming ? (
          <>
            <span className="rec-ask">Discard this recording?</span>
            <span className="rec-fill" />
            <button type="button" className="ui-btn ui-btn-text" onClick={() => setConfirming(false)} autoFocus>
              Keep recording
            </button>
            <button type="button" className="ui-btn ui-btn-danger" onClick={onDiscard}>
              Discard
            </button>
          </>
        ) : (
          <>
            <span className="rec-dot" aria-hidden="true" />
            <span className="rec-state">{paused ? "Paused" : "Recording"}</span>
            <canvas ref={canvasRef} className="rec-wave" aria-hidden="true" />
            <span className="rec-time" aria-label={`${formatDuration(seconds)} recorded`}>
              {formatDuration(seconds)}
            </span>
            <button
              type="button"
              className="rec-icon"
              onClick={() => (paused ? rec.resume() : rec.pause())}
              aria-label={paused ? "Resume recording" : "Pause recording"}
              title={paused ? "Resume" : "Pause"}
            >
              {paused ? <ResumeGlyph /> : <PauseGlyph />}
            </button>
            <button
              type="button"
              className="rec-icon"
              onClick={() => setConfirming(true)}
              aria-label="Discard recording"
              title="Discard"
            >
              <TrashGlyph />
            </button>
            <button type="button" className="ui-btn ui-btn-solid rec-done" onClick={onDone}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
