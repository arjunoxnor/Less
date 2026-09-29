import { Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";
import { decodePeaks, formatDuration } from "../voicenote/waveform";
import { activeRecordings } from "../voicenote/recorder";
import { subscribeUploads, uploadStatusOf } from "../voicenote/upload";
import { getRecording } from "../voicenote/localAudio";
import { playerState, rememberLocalRecording, subscribePlayer, togglePlay } from "../voicenote/player";

/**
 * Voice notes inside an ordinary document.
 *
 *   voicePending  a recording that has not been transcribed yet: a card with
 *                 its waveform, its length, a play button and where it is
 *                 (recording, on this device, uploaded and waiting).
 *   voiceNote     a transcribed recording: the cleaned-up text as ordinary,
 *                 editable paragraphs, marked by a thin line in the left
 *                 margin and a small header with Play and Original. The
 *                 original transcript, fillers and all, is kept in the node.
 *
 * Transcription happens on Arjun's Mac (tools/voice), which swaps a pending
 * card for a transcribed note in the saved document. The audio itself never
 * lives in the document: it is an asset on the server under the note's id.
 */

export const VOICE_ID = /^[a-f0-9]{32}$/;

export function cleanVoiceId(value: unknown): string {
  return typeof value === "string" && VOICE_ID.test(value) ? value : "";
}

/** A length in milliseconds, or 0. */
export function cleanMs(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 && n < 48 * 3600 * 1000 ? n : 0;
}

function cleanWhen(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

function cleanPeaks(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 96) : "";
}

function cleanMime(value: unknown): string {
  return typeof value === "string" && /^audio\/[a-z0-9.+-]+(;[ a-z0-9=.,"+-]*)?$/i.test(value)
    ? value.slice(0, 80)
    : "";
}

/** The original transcript. Generous, but bounded: it rides in the document. */
function cleanRaw(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 200_000) : "";
}

/** "Sep 28, 4:12 PM" */
export function formatRecordedAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const attr = (name: string, clean: (v: unknown) => unknown, fallback: unknown) => ({
  default: fallback,
  rendered: false,
  parseHTML: (el: HTMLElement) => clean(el.getAttribute(name)),
});

const sharedAttributes = () => ({
  id: attr("data-id", cleanVoiceId, ""),
  mime: attr("data-mime", cleanMime, ""),
  duration: attr("data-duration", cleanMs, 0),
  recordedAt: attr("data-recorded", cleanWhen, ""),
  peaks: attr("data-peaks", cleanPeaks, ""),
});

function sharedDataAttributes(attrs: Record<string, unknown>): Record<string, string> {
  return {
    "data-id": cleanVoiceId(attrs.id),
    "data-mime": cleanMime(attrs.mime),
    "data-duration": String(cleanMs(attrs.duration)),
    "data-recorded": cleanWhen(attrs.recordedAt),
    "data-peaks": cleanPeaks(attrs.peaks),
  };
}

/* --- Small DOM helpers for the node views -------------------------------- */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(kind: "play" | "pause" | "mic" | "close"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  const shapes = {
    play: "M5 3.2v9.6c0 .4.4.6.7.4l7.4-4.8a.5.5 0 0 0 0-.8L5.7 2.8c-.3-.2-.7 0-.7.4z",
    pause: "M4.5 3h2v10h-2zM9.5 3h2v10h-2z",
    mic: "M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5zM3.5 7.5a.75.75 0 0 1 1.5 0 3 3 0 0 0 6 0 .75.75 0 0 1 1.5 0 4.5 4.5 0 0 1-3.75 4.44V13.5h1.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5h1.5v-1.56A4.5 4.5 0 0 1 3.5 7.5z",
    close: "M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6",
  } as const;
  path.setAttribute("d", shapes[kind]);
  if (kind === "close") {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("stroke-linecap", "round");
  } else {
    path.setAttribute("fill", "currentColor");
  }
  svg.appendChild(path);
  return svg;
}

function button(className: string, label: string): HTMLButtonElement {
  const b = el("button", className);
  b.type = "button";
  b.tabIndex = -1;
  b.setAttribute("aria-label", label);
  b.title = label;
  return b;
}

/** True for events on the view's own controls, which must never reach the editor. */
function onControl(event: Event): boolean {
  const target = event.target;
  return target instanceof Element && !!target.closest("[data-vn-control]");
}

/* --- The pending card ---------------------------------------------------- */

const BAR_COUNT = 48;

/** Where a pending note stands, from what this device knows. */
export function pendingStatus(opts: {
  recordingHere: boolean;
  state: "recording" | "saved";
  local: boolean | null;
  upload: ReturnType<typeof uploadStatusOf>;
}): string {
  if (opts.recordingHere) return "Recording";
  if (opts.upload?.state === "uploading") return "Uploading";
  if (opts.upload?.state === "waiting") {
    return opts.upload.reason ?? "Saved on this device. It uploads when there is a connection.";
  }
  if (opts.upload?.state !== "done" && opts.local) {
    return "Saved on this device. It uploads when there is a connection.";
  }
  if (opts.state === "recording") return "Unfinished recording. What was saved will be transcribed.";
  return "Waiting to be transcribed";
}

class PendingView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private playBtn: HTMLButtonElement;
  private meta: HTMLElement;
  private bars: HTMLElement[] = [];
  private status: HTMLElement;
  private local: boolean | null = null;
  private unsubs: (() => void)[] = [];

  constructor(node: PMNode) {
    this.node = node;
    this.dom = el("div", "vn-card");
    this.dom.setAttribute("data-voice-pending", "");
    this.dom.setAttribute("contenteditable", "false");

    this.playBtn = button("vn-play", "Play");
    this.playBtn.setAttribute("data-vn-control", "");
    this.playBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const id = cleanVoiceId(this.node.attrs.id);
      if (id) togglePlay(id, cleanMs(this.node.attrs.duration));
    });

    const body = el("div", "vn-card-body");
    const top = el("div", "vn-card-top");
    const label = el("span", "vn-label");
    label.append(icon("mic"), document.createTextNode("Voice note"));
    this.meta = el("span", "vn-meta");
    top.append(label, this.meta);

    const wave = el("div", "vn-bars");
    wave.setAttribute("aria-hidden", "true");
    for (let i = 0; i < BAR_COUNT; i++) {
      const bar = el("span", "vn-bar");
      wave.appendChild(bar);
      this.bars.push(bar);
    }
    this.status = el("div", "vn-status");
    this.status.setAttribute("role", "status");
    body.append(top, wave, this.status);
    this.dom.append(this.playBtn, body);

    this.unsubs.push(subscribeUploads(() => this.render()), subscribePlayer(() => this.render()));
    this.checkLocal();
    this.render();
  }

  private checkLocal() {
    const id = cleanVoiceId(this.node.attrs.id);
    if (!id) return;
    void getRecording(id).then((rec) => {
      this.local = !!rec;
      if (rec) rememberLocalRecording(id, rec.blob);
      this.render();
    });
  }

  private render() {
    const a = this.node.attrs;
    const id = cleanVoiceId(a.id);
    const duration = cleanMs(a.duration);
    const recordingHere = activeRecordings.has(id);
    const state = a.state === "recording" ? "recording" : "saved";
    this.dom.classList.toggle("vn-card-live", recordingHere);

    const when = formatRecordedAt(cleanWhen(a.recordedAt));
    this.meta.textContent = [when, duration ? formatDuration(duration / 1000) : ""]
      .filter(Boolean)
      .join(" · ");

    const player = playerState();
    const mine = player.id === id && !!id;
    const playing = mine && player.playing;
    this.playBtn.replaceChildren(icon(playing ? "pause" : "play"));
    this.playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
    this.playBtn.title = playing ? "Pause" : "Play";
    this.playBtn.disabled = !id || recordingHere;

    const peaks = decodePeaks(a.peaks);
    const total = player.duration || duration / 1000;
    const played = mine && total > 0 ? player.position / total : -1;
    this.bars.forEach((bar, i) => {
      const v = peaks.length ? peaks[Math.floor((i * peaks.length) / BAR_COUNT)] : 0;
      bar.style.height = `${Math.round(12 + v * 88)}%`;
      bar.classList.toggle("on", played >= 0 && i / BAR_COUNT < played);
    });

    this.status.textContent =
      mine && player.error
        ? player.error
        : pendingStatus({ recordingHere, state, local: this.local, upload: uploadStatusOf(id) });
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const idChanged = node.attrs.id !== this.node.attrs.id;
    this.node = node;
    if (idChanged) this.checkLocal();
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return onControl(event);
  }

  ignoreMutation(): boolean {
    return true;
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
  }

  destroy() {
    this.unsubs.forEach((fn) => fn());
  }
}

export const VoicePending = Node.create({
  name: "voicePending",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      ...sharedAttributes(),
      state: {
        default: "saved",
        rendered: false,
        parseHTML: (el: HTMLElement) => (el.getAttribute("data-state") === "recording" ? "recording" : "saved"),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-voice-pending]" }];
  },

  renderHTML({ node }) {
    const duration = cleanMs(node.attrs.duration);
    return [
      "div",
      {
        "data-voice-pending": "",
        ...sharedDataAttributes(node.attrs),
        "data-state": node.attrs.state === "recording" ? "recording" : "saved",
        class: "vn-card",
      },
      duration ? `Voice note (${formatDuration(duration / 1000)})` : "Voice note",
    ];
  },

  addNodeView() {
    return ({ node }) => new PendingView(node);
  },
});

/* --- The transcribed note ------------------------------------------------ */

export interface OriginalTranscript {
  id: string;
  raw: string;
  recordedAt: string;
  duration: number;
}

export interface VoiceNoteOptions {
  /** Show the original transcript (the app opens a dialog). */
  onOriginal: ((note: OriginalTranscript) => void) | null;
}

class NoteView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: PMNode;
  private rail: HTMLElement;
  private railFrame = 0;
  private gapWatch: MutationObserver | null = null;
  private sizeWatch: ResizeObserver | null = null;
  private playBtn: HTMLButtonElement;
  private time: HTMLElement;
  private meta: HTMLElement;
  private originalBtn: HTMLButtonElement;
  private unsubs: (() => void)[] = [];

  constructor(
    node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private options: VoiceNoteOptions
  ) {
    this.node = node;
    this.dom = el("section", "vn-note");
    this.dom.setAttribute("data-voice-note", "");

    // The line in the margin. Drawn in pieces, so that where the note runs
    // onto the next sheet it stops at the last line of one page and starts
    // again at the first line of the next, instead of crossing the desk.
    const rail = el("div", "vn-rail");
    rail.setAttribute("contenteditable", "false");
    rail.setAttribute("aria-hidden", "true");
    rail.appendChild(el("span", "vn-rail-seg"));
    this.rail = rail;

    // The header is chrome, not text: the paginator skips it when it looks
    // for lines to break between (docPagination.ts, data-page-skip).
    const head = el("div", "vn-head");
    head.setAttribute("contenteditable", "false");
    head.setAttribute("data-page-skip", "");
    head.setAttribute("data-vn-control", "");

    this.playBtn = button("vn-head-play", "Play the recording");
    this.time = el("span", "vn-time");
    this.playBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const id = cleanVoiceId(this.node.attrs.id);
      if (id) togglePlay(id, cleanMs(this.node.attrs.duration));
    });

    const label = el("span", "vn-label", "Voice note");
    this.meta = el("span", "vn-meta");
    const spacer = el("span", "vn-spacer");

    this.originalBtn = button("vn-head-btn", "Show the original transcript");
    this.originalBtn.textContent = "Original";
    this.originalBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const a = this.node.attrs;
      this.options.onOriginal?.({
        id: cleanVoiceId(a.id),
        raw: cleanRaw(a.raw),
        recordedAt: cleanWhen(a.recordedAt),
        duration: cleanMs(a.duration),
      });
    });

    const unmark = button("vn-head-x", "Remove the voice note marker. The text stays.");
    unmark.appendChild(icon("close"));
    unmark.addEventListener("click", (event) => {
      event.preventDefault();
      this.unwrap();
    });

    head.append(this.playBtn, label, this.meta, spacer, this.originalBtn, unmark);
    this.contentDOM = el("div", "vn-body");
    this.dom.append(rail, head, this.contentDOM);

    this.unsubs.push(subscribePlayer(() => this.render()));
    this.render();

    // Page breaks are spacers the paginator puts inside the note; watch for
    // them coming and going, and for the note changing height.
    this.gapWatch = new MutationObserver((records) => {
      const isGap = (n: globalThis.Node) => n instanceof HTMLElement && n.classList.contains("doc-page-gap");
      if (records.some((r) => [...r.addedNodes, ...r.removedNodes].some(isGap))) this.scheduleRail();
    });
    this.gapWatch.observe(this.contentDOM, { childList: true, subtree: true });
    if (typeof ResizeObserver !== "undefined") {
      this.sizeWatch = new ResizeObserver(() => this.scheduleRail());
      this.sizeWatch.observe(this.dom);
    }
  }

  private scheduleRail() {
    if (this.railFrame || typeof requestAnimationFrame !== "function") return;
    this.railFrame = requestAnimationFrame(() => {
      this.railFrame = 0;
      this.layoutRail();
    });
  }

  /** One piece of line per page the note is on. */
  private layoutRail() {
    const box = this.rail.getBoundingClientRect();
    const pieces: [number, number][] = [];
    let from = 0;
    for (const gap of this.contentDOM.querySelectorAll<HTMLElement>(".doc-page-gap")) {
      const r = gap.getBoundingClientRect();
      pieces.push([from, r.top - box.top]);
      from = r.bottom - box.top;
    }
    pieces.push([from, box.height]);
    const visible = pieces.filter(([a, b]) => b - a > 1);
    while (this.rail.children.length > visible.length) this.rail.lastElementChild!.remove();
    while (this.rail.children.length < visible.length) this.rail.appendChild(el("span", "vn-rail-seg"));
    visible.forEach(([a, b], i) => {
      const seg = this.rail.children[i] as HTMLElement;
      seg.style.top = `${Math.round(a)}px`;
      seg.style.height = `${Math.round(b - a)}px`;
      seg.style.bottom = "auto";
    });
  }

  private render() {
    const a = this.node.attrs;
    const id = cleanVoiceId(a.id);
    const duration = cleanMs(a.duration);
    const player = playerState();
    const mine = player.id === id && !!id;
    const playing = mine && player.playing;
    this.playBtn.replaceChildren(icon(playing ? "pause" : "play"), this.time);
    this.playBtn.setAttribute("aria-label", playing ? "Pause" : "Play the recording");
    this.playBtn.title = mine && player.error ? player.error : playing ? "Pause" : "Play the recording";
    this.playBtn.disabled = !id;
    this.time.textContent =
      mine && (playing || player.position > 0)
        ? `${formatDuration(player.position)} / ${formatDuration(player.duration || duration / 1000)}`
        : duration
          ? formatDuration(duration / 1000)
          : "";
    this.meta.textContent = formatRecordedAt(cleanWhen(a.recordedAt));
    this.originalBtn.hidden = !cleanRaw(a.raw);
  }

  /** Keep the text, drop the marker. */
  private unwrap() {
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    const node = this.view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "voiceNote") return;
    const tr = this.view.state.tr.replaceWith(pos, pos + node.nodeSize, node.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return onControl(event);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  destroy() {
    this.unsubs.forEach((fn) => fn());
    this.gapWatch?.disconnect();
    this.sizeWatch?.disconnect();
    if (this.railFrame) cancelAnimationFrame(this.railFrame);
  }
}

export const VoiceNote = Node.create<VoiceNoteOptions>({
  name: "voiceNote",
  // Above the editor's own Enter (priority 100), which would otherwise split
  // the empty line again instead of letting it leave the note.
  priority: 110,
  group: "block",
  content: "block+",
  defining: true,
  // Backspace at the start of the note, or joins across its edge, cannot
  // quietly tear paragraphs out of it. Enter on an empty last line leaves it.
  isolating: true,

  addOptions() {
    return { onOriginal: null };
  },

  addAttributes() {
    return {
      ...sharedAttributes(),
      raw: attr("data-raw", cleanRaw, ""),
    };
  },

  parseHTML() {
    return [
      {
        tag: "section[data-voice-note]",
        contentElement: (dom: globalThis.Node) =>
          ((dom as HTMLElement).querySelector(":scope > .vn-body") as HTMLElement | null) ?? (dom as HTMLElement),
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "section",
      {
        "data-voice-note": "",
        ...sharedDataAttributes(node.attrs),
        "data-raw": cleanRaw(node.attrs.raw),
        class: "vn-note",
      },
      ["div", { class: "vn-body" }, 0],
    ];
  },

  addNodeView() {
    return ({ node, view, getPos }) => new NoteView(node, view, getPos, this.options);
  },

  addKeyboardShortcuts() {
    return {
      // An empty last paragraph in a note: Enter steps out below it, the way
      // Enter on an empty list item ends the list.
      Enter: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth < 2) return false;
        const para = $from.parent;
        const note = $from.node(-1);
        if (note.type.name !== "voiceNote" || para.type.name !== "paragraph" || para.content.size > 0) {
          return false;
        }
        if ($from.index(-1) !== note.childCount - 1 || note.childCount < 2) return false;
        const paraStart = $from.before();
        const noteEnd = $from.after(-1);
        return this.editor
          .chain()
          .command(({ tr }) => {
            tr.delete(paraStart, paraStart + para.nodeSize);
            const after = tr.mapping.map(noteEnd);
            tr.insert(after, state.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            return true;
          })
          .scrollIntoView()
          .run();
      },
    };
  },
});

export const voiceExtensions = [VoicePending, VoiceNote];

/* --- Editing helpers ------------------------------------------------------ */

export interface PendingAttrs {
  id: string;
  mime?: string;
  duration?: number;
  recordedAt?: string;
  peaks?: string;
  state?: "recording" | "saved";
}

/** Where the pending card with this id sits, if it is in the document. */
export function findVoiceNode(
  editor: Editor,
  id: string
): { pos: number; node: PMNode } | null {
  const hit: { found: { pos: number; node: PMNode } | null } = { found: null };
  editor.state.doc.descendants((node, pos) => {
    if (hit.found) return false;
    if ((node.type.name === "voicePending" || node.type.name === "voiceNote") && node.attrs.id === id) {
      hit.found = { pos, node };
      return false;
    }
    return true;
  });
  return hit.found;
}

/**
 * Put a new card in the document for a recording that is starting. On an
 * empty line it takes that line's place; otherwise it goes below the block
 * the caret is in, so it never splits what is being written.
 */
export function insertVoicePending(editor: Editor, attrs: PendingAttrs): boolean {
  const { state } = editor;
  const type = state.schema.nodes.voicePending;
  if (!type || !cleanVoiceId(attrs.id)) return false;
  const card = type.create({ ...attrs, state: attrs.state ?? "recording" });
  const { $from } = state.selection;
  const tr = state.tr;
  if ($from.depth === 0) {
    // A whole block is selected (a picture, another card): below it.
    tr.insert(state.selection.to, card);
  } else {
    const top = $from.node(1);
    const start = $from.before(1);
    const emptyLine = top.type.name === "paragraph" && top.content.size === 0;
    if (emptyLine) {
      tr.replaceWith(start, start + top.nodeSize, card);
      // Keep writing on the line below the card.
      const after = start + card.nodeSize;
      const next = tr.doc.nodeAt(after);
      if (!next || next.type.name !== "paragraph") {
        tr.insert(after, state.schema.nodes.paragraph.create());
      }
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
    } else {
      tr.insert($from.after(1), card);
    }
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Update a card in place. Not an undo step: undo must never turn a finished
 *  recording back into one that is still going. */
export function updateVoicePending(editor: Editor, id: string, attrs: Partial<PendingAttrs>): boolean {
  const hit = findVoiceNode(editor, id);
  if (!hit || hit.node.type.name !== "voicePending") return false;
  const tr = editor.state.tr.setNodeMarkup(hit.pos, undefined, { ...hit.node.attrs, ...attrs });
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return true;
}

export function removeVoicePending(editor: Editor, id: string): boolean {
  const hit = findVoiceNode(editor, id);
  if (!hit || hit.node.type.name !== "voicePending") return false;
  const tr = editor.state.tr.delete(hit.pos, hit.pos + hit.node.nodeSize);
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return true;
}

/** A finished recording whose card was deleted while it recorded still gets
 *  one, at the end: the audio is too precious to lose to a stray keystroke. */
export function ensureVoicePending(editor: Editor, attrs: PendingAttrs): void {
  if (updateVoicePending(editor, attrs.id, attrs)) return;
  const type = editor.state.schema.nodes.voicePending;
  if (!type) return;
  const tr = editor.state.tr.insert(editor.state.doc.content.size, type.create({ ...attrs }));
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}
