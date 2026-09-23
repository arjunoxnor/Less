"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useDictation } from "@/lib/voice/speech";
import { docToLines, readVoiceDoc, requestProcess, type VoiceState } from "@/lib/voice/markers";

/** How long a job may sit unclaimed before we stop implying it is fine. The
    worker polls far faster than this; silence past it means nobody is home. */
const UNCLAIMED_GRACE_MS = 90_000;

export function VoiceStrip({
  editor,
  onFlush,
  signedIn,
}: {
  editor: Editor | null;
  /** Push to the cloud immediately, so the worker sees the request now rather
      than at the next autosave. */
  onFlush: () => void;
  signedIn: boolean;
}) {
  const [state, setState] = useState<VoiceState>("idle");
  const [errorText, setErrorText] = useState<string | undefined>();
  const [pendingWords, setPendingWords] = useState(0);
  const [stale, setStale] = useState(false);
  const pendingSince = useRef<number | null>(null);

  // Read state from the document itself on a slow tick. Any path that can change
  // the text (typing, dictation, a cloud pull carrying the worker's reply) is
  // covered by this without wiring into each one.
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const doc = readVoiceDoc(docToLines(editor.getJSON()));
      setState(doc.state);
      setErrorText(doc.errorMessage);
      setPendingWords(doc.pending.join(" ").split(/\s+/).filter(Boolean).length);

      if (doc.state === "pending") {
        pendingSince.current ??= Date.now();
        setStale(Date.now() - (pendingSince.current ?? 0) > UNCLAIMED_GRACE_MS);
      } else {
        pendingSince.current = null;
        setStale(false);
      }
    };
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [editor]);

  /** Dictated words land at the very end, never at the cursor: the writer may
      have clicked into earlier text to read it back, and dropping a sentence
      into the middle of a finished scene would be worse than useless. */
  const appendFinal = useCallback(
    (text: string) => {
      if (!editor) return;
      const end = editor.state.doc.content.size;
      // The caret stays where the writer left it: moving it to the end on
      // every dictated phrase scrolled the page away from what they were
      // reading.
      editor
        .chain()
        .insertContentAt(
          end,
          { type: "paragraph", content: [{ type: "text", text }] },
          { updateSelection: false }
        )
        .run();
    },
    [editor]
  );

  const { status: micStatus, interim, message: micMessage, start, stop } = useDictation(appendFinal);
  const listening = micStatus === "listening";

  const onProcess = useCallback(() => {
    if (!editor) return;
    const lines = docToLines(editor.getJSON());
    const next = requestProcess(lines);
    if (next === lines) return; // already queued
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .insertContentAt(
        end,
        {
          type: "paragraph",
          content: [{ type: "text", text: next[next.length - 1] }],
        },
        { updateSelection: false }
      )
      .run();
    onFlush();
  }, [editor, onFlush]);

  const busy = state === "pending" || state === "working";

  let line = "Dictate or type, then press Process.";
  if (!signedIn) line = "Sign in to send this to Claude. Your words are saved on this device either way.";
  else if (state === "working") line = "Claude has it and is working.";
  else if (state === "pending" && stale)
    line = "Claude has not picked this up. The Mac at home may be asleep. Your words are safe and will process when it wakes.";
  else if (state === "pending") line = "Sent. Waiting for Claude to pick it up.";
  else if (state === "error") line = `${errorText ?? "Something failed."} Press Process to try again.`;
  else if (pendingWords > 0) line = `${pendingWords} ${pendingWords === 1 ? "word" : "words"} ready to process.`;

  return (
    <div className="voice-strip" role="group" aria-label="Voice note controls">
      <button
        type="button"
        className="tb-btn"
        onClick={listening ? stop : start}
        disabled={micStatus === "unsupported"}
        aria-pressed={listening}
        title={
          micStatus === "unsupported"
            ? "This browser has no built-in dictation. Type or paste instead."
            : undefined
        }
      >
        {listening ? "Stop" : "Record"}
      </button>

      <button
        type="button"
        className="tb-btn"
        onClick={onProcess}
        disabled={busy || pendingWords === 0 || !signedIn}
      >
        {busy ? "Processing" : "Process"}
      </button>

      <span className="voice-state" aria-live="polite">
        {line}
      </span>

      {listening && interim ? (
        <span className="voice-interim" aria-hidden="true">
          {interim}
        </span>
      ) : null}

      {micMessage ? (
        <span className="voice-mic-error" role="status">
          {micMessage}
        </span>
      ) : null}
    </div>
  );
}
