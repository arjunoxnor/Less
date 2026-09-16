"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser dictation, wrapped so the editor never has to know about the Web
 * Speech API's two awkward habits:
 *
 *  1. It stops on its own. Even with `continuous`, Chrome ends a session after a
 *     stretch of silence. A writer pausing to think is not a writer who finished,
 *     so we restart until they say stop.
 *  2. It fails in ways that look identical from the outside. A denied mic, a
 *     policy-blocked mic and a missing network all surface as an "error" event
 *     with a short code. The codes matter here: this is meant to be used on a
 *     managed work laptop where the most likely outcome is a policy block, and
 *     "it didn't work" would send the writer hunting the wrong problem.
 */

export type SpeechStatus = "unsupported" | "idle" | "listening" | "error";

interface SpeechLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

function getCtor(): (new () => SpeechLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Plain-English causes, because the raw codes are not actionable. */
function explain(code: string): string {
  switch (code) {
    case "not-allowed":
      return "The browser blocked the microphone. Allow it for this site, then press record again.";
    case "service-not-allowed":
      return "Your device policy blocks dictation. You can still type or paste into this note and press Process.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition could not reach the network.";
    case "no-speech":
      return "";
    case "aborted":
      return "";
    default:
      return `Dictation stopped (${code}).`;
  }
}

export function useDictation(onFinal: (text: string) => void) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [interim, setInterim] = useState("");
  const [message, setMessage] = useState("");

  const recRef = useRef<SpeechLike | null>(null);
  // The user's intent, which outlives any single recognition session.
  const wantRef = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;
  // A failing restart loop would spin forever and pin the CPU, so back off.
  const failRef = useRef(0);

  useEffect(() => {
    if (!getCtor()) setStatus("unsupported");
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return;
    }
    wantRef.current = true;
    failRef.current = 0;

    const begin = () => {
      if (!wantRef.current) return;
      const rec = new Ctor();
      recRef.current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onresult = (e: any) => {
        let done = "";
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) done += r[0].transcript;
          else live += r[0].transcript;
        }
        setInterim(live);
        if (done.trim()) {
          failRef.current = 0;
          finalRef.current(done.trim());
        }
      };

      rec.onerror = (e: any) => {
        const code = String(e?.error ?? "unknown");
        const text = explain(code);
        // "no-speech" and "aborted" are ordinary pauses, not failures.
        if (!text) return;
        wantRef.current = false;
        setStatus("error");
        setMessage(text);
      };

      rec.onend = () => {
        setInterim("");
        if (!wantRef.current) {
          // "end" always follows "error". Resetting to idle here would erase
          // the explanation a moment after it appeared, and the writer would
          // see the button snap back with no idea why. Keep the error.
          setStatus((s) => (s === "error" ? s : "idle"));
          return;
        }
        failRef.current += 1;
        if (failRef.current > 8) {
          wantRef.current = false;
          setStatus("error");
          setMessage("Dictation kept dropping. Type or paste instead, then press Process.");
          return;
        }
        setTimeout(begin, Math.min(200 * failRef.current, 2000));
      };

      try {
        rec.start();
        setStatus("listening");
        setMessage("");
      } catch {
        // start() throws if a session is somehow already running; the onend
        // handler will bring us back around.
      }
    };

    begin();
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    setInterim("");
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setStatus((s) => (s === "error" ? s : "idle"));
  }, []);

  // Leaving the page mid-dictation must release the microphone.
  useEffect(() => () => {
    wantRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* nothing to stop */
    }
  }, []);

  return { status, interim, message, start, stop };
}
