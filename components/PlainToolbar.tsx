"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { ChainedCommands, Editor } from "@tiptap/react";
import { DOC_FONTS, DOC_SIZES, docFontOf, sizeOf, styleAt, wordAround, type DocFont } from "@/lib/editor/docFonts";
import type { DocFontChoice } from "@/lib/storage/localStore";

/**
 * The plain document's formatting controls: marks, text color and highlight,
 * lists and checklists, alignment, links, and clear formatting. Rendered as
 * the slim second row of the editor shell (Superaudit 2, task 10): formatting
 * acts on a selection, so these stay always visible rather than living in the
 * dock. Export moved to the shell's top bar.
 */

const TEXT_COLORS: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Gray", value: "#6b7280" },
  { label: "Red", value: "#d83a3a" },
  { label: "Orange", value: "#d97316" },
  { label: "Green", value: "#1f8f4e" },
  { label: "Blue", value: "#2f6df6" },
  { label: "Purple", value: "#7c3aed" },
];

const HIGHLIGHTS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#fff1a8" },
  { label: "Green", value: "#c6f6c2" },
  { label: "Blue", value: "#c2e0ff" },
  { label: "Pink", value: "#ffc9e0" },
];

function AlignIcon({ kind }: { kind: "left" | "center" | "right" | "justify" }) {
  const lines: Record<string, [number, number][]> = {
    left: [[3, 16], [3, 11], [3, 16], [3, 11]],
    center: [[5, 14], [7, 10], [5, 14], [7, 10]],
    right: [[5, 18], [10, 18], [5, 18], [10, 18]],
    justify: [[3, 18], [3, 18], [3, 18], [3, 18]],
  };
  const rows = [6, 10, 14, 18];
  return (
    <svg width="16" height="16" viewBox="0 0 21 24" aria-hidden="true">
      {rows.map((y, i) => (
        <line
          key={y}
          x1={lines[kind][i][0]}
          x2={lines[kind][i][1]}
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function PlainToolbar({ editor }: { editor: Editor | null }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [menu, setMenu] = useState<null | "color" | "highlight" | "link">(null);
  const [linkDraft, setLinkDraft] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;
    const h = () => force();
    editor.on("transaction", h);
    return () => {
      editor.off("transaction", h);
    };
  }, [editor]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest(".tb-menu")) setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Let a higher stacked surface dismiss itself first.
      if (
        document.querySelector(
          ".cmd-backdrop, .spell-menu, .ui-modal-scrim, .modal-backdrop"
        )
      ) {
        return;
      }
      const trigger = menuRef.current?.querySelector<HTMLButtonElement>(":scope > button");
      event.preventDefault();
      event.stopImmediatePropagation();
      setMenu(null);
      queueMicrotask(() => trigger?.focus());
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu]);

  if (!editor) return null;

  const chain = () => editor.chain().focus();
  const Btn = (
    label: ReactNode,
    active: boolean,
    onClick: () => void,
    title: string,
    options?: {
      toggle?: boolean;
      hasPopup?: "menu" | "dialog";
      expanded?: boolean;
    }
  ) => (
    <button
      type="button"
      className={"tb-btn" + (active ? " tb-btn-active" : "")}
      onClick={onClick}
      title={title}
      aria-pressed={options?.toggle === false ? undefined : active}
      aria-haspopup={options?.hasPopup}
      aria-expanded={options?.hasPopup ? options.expanded : undefined}
    >
      {label}
    </button>
  );

  // Link editing lives in a small anchored popover (D9: no window.prompt).
  const openLinkPopover = () => {
    setMenu((m) => {
      if (m === "link") return null;
      setLinkDraft((editor.getAttributes("link").href as string) || "");
      return "link";
    });
  };
  const applyLink = () => {
    const url = linkDraft.trim();
    if (url === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url }).run();
    setMenu(null);
  };
  const removeLink = () => {
    chain().extendMarkRange("link").unsetLink().run();
    setMenu(null);
  };

  return (
    <>
      <div className="toolbar-group">
        {Btn(<strong>B</strong>, editor.isActive("bold"), () => chain().toggleBold().run(), "Bold (Ctrl+B)")}
        {Btn(<em>I</em>, editor.isActive("italic"), () => chain().toggleItalic().run(), "Italic (Ctrl+I)")}
        {Btn(<span style={{ textDecoration: "underline" }}>U</span>, editor.isActive("underline"), () => chain().toggleUnderline().run(), "Underline (Ctrl+U)")}
        {Btn(<span style={{ textDecoration: "line-through" }}>S</span>, editor.isActive("strike"), () => chain().toggleStrike().run(), "Strikethrough")}
      </div>

      <div className="toolbar-group">
        <div className="tb-menu" ref={menu === "color" ? menuRef : undefined}>
          <button
            type="button"
            className={"tb-btn" + (menu === "color" ? " tb-btn-active" : "")}
            onClick={() => setMenu((m) => (m === "color" ? null : "color"))}
            title="Text color"
            aria-haspopup="menu"
            aria-expanded={menu === "color"}
          >
            <span className="pt-aglyph" style={{ borderBottomColor: (editor.getAttributes("textStyle").color as string) || "currentColor" }}>A</span>
          </button>
          {menu === "color" && (
            <div className="tb-menu-list pt-swatches" role="menu" aria-label="Text color">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  role="menuitem"
                  className="pt-swatch"
                  title={c.label}
                  onClick={() => {
                    if (c.value === null) chain().unsetColor().run();
                    else chain().setColor(c.value).run();
                    setMenu(null);
                  }}
                >
                  <span className="pt-swatch-dot" style={{ background: c.value ?? "var(--page-fg)", border: c.value === null ? "1px solid var(--border)" : "none" }} />
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tb-menu" ref={menu === "highlight" ? menuRef : undefined}>
          <button
            type="button"
            className={"tb-btn" + (editor.isActive("highlight") ? " tb-btn-active" : "")}
            onClick={() => setMenu((m) => (m === "highlight" ? null : "highlight"))}
            title="Highlight"
            aria-haspopup="menu"
            aria-expanded={menu === "highlight"}
          >
            <span className="pt-hl">H</span>
          </button>
          {menu === "highlight" && (
            <div className="tb-menu-list pt-swatches" role="menu" aria-label="Highlight color">
              {HIGHLIGHTS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  role="menuitem"
                  className="pt-swatch"
                  title={c.label}
                  onClick={() => {
                    chain().setHighlight({ color: c.value }).run();
                    setMenu(null);
                  }}
                >
                  <span className="pt-swatch-dot" style={{ background: c.value }} />
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="pt-swatch"
                onClick={() => {
                  chain().unsetHighlight().run();
                  setMenu(null);
                }}
              >
                <span className="pt-swatch-dot" style={{ background: "var(--page-bg)", border: "1px solid var(--border)" }} />
                None
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-group">
        {Btn("• List", editor.isActive("bulletList"), () => chain().toggleBulletList().run(), "Bullet list")}
        {Btn("1. List", editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), "Numbered list")}
        {Btn("Checklist", editor.isActive("taskList"), () => chain().toggleTaskList().run(), "Checklist")}
        {Btn("Quote", editor.isActive("blockquote"), () => chain().toggleBlockquote().run(), "Quote")}
      </div>

      <div className="toolbar-group">
        {Btn(<AlignIcon kind="left" />, editor.isActive({ textAlign: "left" }), () => chain().setTextAlign("left").run(), "Align left")}
        {Btn(<AlignIcon kind="center" />, editor.isActive({ textAlign: "center" }), () => chain().setTextAlign("center").run(), "Align center")}
        {Btn(<AlignIcon kind="right" />, editor.isActive({ textAlign: "right" }), () => chain().setTextAlign("right").run(), "Align right")}
        {Btn(<AlignIcon kind="justify" />, editor.isActive({ textAlign: "justify" }), () => chain().setTextAlign("justify").run(), "Justify")}
      </div>

      <div className="toolbar-group">
        <div className="tb-menu" ref={menu === "link" ? menuRef : undefined}>
          {Btn(
            "Link",
            editor.isActive("link") || menu === "link",
            openLinkPopover,
            "Insert or edit link",
            { hasPopup: "dialog", expanded: menu === "link" }
          )}
          {menu === "link" && (
            <div
              className="tb-menu-list pt-link-pop"
              role="dialog"
              aria-label="Edit link"
            >
              <input
                type="url"
                className="pt-link-input"
                placeholder="https://"
                value={linkDraft}
                autoFocus
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyLink();
                  } else if (e.key === "Escape") {
                    setMenu(null);
                  }
                }}
                aria-label="Link URL"
              />
              <div className="pt-link-row">
                <button type="button" className="tb-btn" onClick={removeLink}>
                  Remove
                </button>
                <button type="button" className="tb-btn tb-btn-active" onClick={applyLink}>
                  Set
                </button>
              </div>
            </div>
          )}
        </div>
        {Btn("Divider", false, () => chain().setHorizontalRule().run(), "Horizontal rule", { toggle: false })}
        {Btn("Clear", false, () => chain().unsetAllMarks().run(), "Clear formatting", { toggle: false })}
      </div>
    </>
  );
}

/** A toolbar popover's open state, shut by a click outside it or by Escape. */
function usePopover<T extends string>() {
  const [menu, setMenu] = useState<T | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const trigger = ref.current?.querySelector<HTMLButtonElement>(":scope > button");
      event.preventDefault();
      event.stopImmediatePropagation();
      setMenu(null);
      queueMicrotask(() => trigger?.focus());
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);
  return { menu, setMenu, ref };
}

function Caret() {
  return (
    <svg className="tb-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The font and the size, for what is selected: pick a font with a line or
 * two selected and only those words change. With nothing selected it is the
 * word the caret is in, or else what is typed next. Each menu ends with a way
 * to make the choice the default, the look of all text with none of its own.
 */
export function FontControls({
  editor,
  baseFont,
  baseSize,
  onBaseChange,
}: {
  editor: Editor | null;
  baseFont: DocFontChoice;
  baseSize: number;
  onBaseChange: (patch: { docFont?: DocFontChoice; docFontSize?: number }) => void;
}) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const font = usePopover<"font">();
  const size = usePopover<"size">();

  useEffect(() => {
    if (!editor) return;
    const h = () => force();
    editor.on("transaction", h);
    return () => {
      editor.off("transaction", h);
    };
  }, [editor]);

  if (!editor) return null;

  const base = DOC_FONTS.find((f) => f.key === baseFont) ?? DOC_FONTS[0];
  const fam = styleAt(editor.state, "fontFamily");
  const px = styleAt(editor.state, "fontSize");
  const current: DocFont | null = fam.mixed ? null : fam.value ? docFontOf(fam.value) : base;
  const fontLabel = fam.mixed ? "Mixed" : (current?.label ?? fam.value?.split(",")[0].replace(/["']/g, "").trim() ?? base.label);
  const currentSize = px.mixed ? null : (sizeOf(px.value) ?? baseSize);

  // To what is selected; with nothing selected, to the word the caret is in
  // (then the caret goes back where it was), or else to what is typed next.
  const styleSelection = (run: (c: ChainedCommands) => ChainedCommands) => {
    const word = wordAround(editor.state);
    const caret = editor.state.selection.from;
    const c = editor.chain().focus();
    (word ? run(c.setTextSelection(word)).setTextSelection(caret) : run(c)).run();
  };
  const pickFont = (f: DocFont) => {
    // The default font needs no mark of its own: the text follows the default.
    styleSelection((c) => (f.key === baseFont ? c.unsetFontFamily() : c.setFontFamily(f.stack)));
    font.setMenu(null);
  };
  const pickSize = (n: number) => {
    styleSelection((c) => (n === baseSize ? c.unsetFontSize() : c.setFontSize(`${n}px`)));
    size.setMenu(null);
  };

  return (
    <div className="toolbar-group">
      <div className="tb-menu" ref={font.ref}>
        <button
          type="button"
          className={"tb-btn tb-font" + (font.menu ? " tb-btn-active" : "")}
          onClick={() => font.setMenu((m) => (m ? null : "font"))}
          title="Font: changes what is selected (or the word the cursor is in)"
          aria-label={`Font: ${fontLabel}`}
          aria-haspopup="menu"
          aria-expanded={!!font.menu}
        >
          <span className="tb-font-name" style={{ fontFamily: current?.stack }}>
            {fontLabel}
          </span>
          <Caret />
        </button>
        {font.menu && (
          <div className="tb-menu-list tb-menu-list-end pt-fonts" role="menu" aria-label="Font">
            {DOC_FONTS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="menuitemradio"
                aria-checked={current?.key === f.key}
                className="pt-font"
                onClick={() => pickFont(f)}
              >
                <span style={{ fontFamily: f.stack }}>{f.label}</span>
                {f.key === baseFont && <span className="pt-font-note">Default</span>}
              </button>
            ))}
            {current && current.key !== baseFont && (
              <>
                <div className="pt-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="pt-font pt-font-action"
                  title="The font of all text that has no font of its own, in every document"
                  onClick={() => {
                    onBaseChange({ docFont: current.key });
                    font.setMenu(null);
                  }}
                >
                  Make {current.label} the default font
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <div className="tb-menu" ref={size.ref}>
        <button
          type="button"
          className={"tb-btn tb-size" + (size.menu ? " tb-btn-active" : "")}
          onClick={() => size.setMenu((m) => (m ? null : "size"))}
          title="Size: changes what is selected (or the word the cursor is in)"
          aria-label={`Size: ${currentSize ?? "mixed"}`}
          aria-haspopup="menu"
          aria-expanded={!!size.menu}
        >
          <span className="tb-size-num">{currentSize ?? "Mixed"}</span>
          <Caret />
        </button>
        {size.menu && (
          <div className="tb-menu-list tb-menu-list-end pt-sizes" role="menu" aria-label="Size">
            {DOC_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                role="menuitemradio"
                aria-checked={currentSize === n}
                className="pt-font"
                onClick={() => pickSize(n)}
              >
                <span>{n}</span>
                {n === baseSize && <span className="pt-font-note">Default</span>}
              </button>
            ))}
            {currentSize !== null && currentSize !== baseSize && (
              <>
                <div className="pt-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="pt-font pt-font-action"
                  title="The size of all text that has no size of its own, in every document"
                  onClick={() => {
                    onBaseChange({ docFontSize: currentSize });
                    size.setMenu(null);
                  }}
                >
                  Make {currentSize} the default size
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
