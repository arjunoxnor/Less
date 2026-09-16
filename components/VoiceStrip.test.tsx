// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { buildPlainExtensions } from "@/lib/editor/buildPlainExtensions";
import { PROCESS, docToLines } from "@/lib/voice/markers";
import { VoiceStrip } from "./VoiceStrip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

function paragraph(text: string) {
  return text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
}

async function mount(lines: string[], signedIn: boolean, onFlush = vi.fn()) {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildPlainExtensions(),
    content: { type: "doc", content: lines.map(paragraph) },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<VoiceStrip editor={editor} onFlush={onFlush} signedIn={signedIn} />);
  });
  const buttons = Array.from(host.querySelectorAll("button"));
  const process = buttons.find((b) => /Process/.test(b.textContent ?? ""))!;
  const record = buttons.find((b) => /Record|Stop/.test(b.textContent ?? ""))!;
  return { process, record, onFlush, status: () => host?.querySelector(".voice-state")?.textContent ?? "" };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  editor?.destroy();
  root = null;
  host = null;
  editor = null;
});

describe("VoiceStrip", () => {
  it("appends the Process marker at the END and pushes immediately", async () => {
    const { process, onFlush } = await mount(["we are in the kitchen", "sarah comes in"], true);
    // Put the caret at the start: dictation and requests must never land at
    // the caret, which the writer may have parked inside earlier text.
    editor!.commands.setTextSelection(1);
    expect(process.disabled).toBe(false);
    await act(async () => process.click());
    const lines = docToLines(editor!.getJSON());
    expect(lines[lines.length - 1]).toBe(PROCESS);
    expect(lines[0]).toBe("we are in the kitchen");
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("will not queue the same words twice", async () => {
    const { process, onFlush } = await mount(["words", PROCESS], true);
    await act(async () => process.click());
    const lines = docToLines(editor!.getJSON());
    expect(lines.filter((l) => l === PROCESS)).toHaveLength(1);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("has nothing to send from an empty note", async () => {
    const { process } = await mount([""], true);
    expect(process.disabled).toBe(true);
  });

  it("explains that a signed-out note cannot reach the Mac, and keeps Process off", async () => {
    const { process, status } = await mount(["words"], false);
    expect(process.disabled).toBe(true);
    expect(status()).toMatch(/Sign in/);
    expect(status()).toMatch(/saved on this device/);
  });

  it("disables Record where the browser has no dictation, with a way forward", async () => {
    const { record } = await mount(["words"], true);
    // jsdom has no SpeechRecognition, which is also what a locked-down browser looks like.
    expect(record.disabled).toBe(true);
    expect(record.title).toMatch(/Type or paste/);
  });
});
