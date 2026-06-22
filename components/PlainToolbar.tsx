"use client";

import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import type { PlainExportFormat } from "@/lib/export/plainExport";

/**
 * Google-Docs-style formatting toolbar for plain documents: marks, text color
 * and highlight, headings, lists and checklists, alignment, links, and clear
 * formatting. None of this exists in the strict screenplay editor.
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

export function PlainToolbar({
  editor,
  onExport,
}: {
  editor: Editor | null;
  onExport: (format: PlainExportFormat) => void;
}) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [menu, setMenu] = useState<null | "export" | "color" | "highlight">(null);
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

  if (!editor) return null;

  const chain = () => editor.chain().focus();
  const Btn = (label: ReactNode, active: boolean, onClick: () => void, title: string) => (
    <button
      type="button"
      className={"tb-btn" + (active ? " tb-btn-active" : "")}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );

  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string) || "";
    const url = window.prompt("Link URL (leave empty to remove)", prev);
    if (url === null) return;
    if (url.trim() === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
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
          >
            <span className="pt-aglyph" style={{ borderBottomColor: (editor.getAttributes("textStyle").color as string) || "currentColor" }}>A</span>
          </button>
          {menu === "color" && (
            <div className="tb-menu-list pt-swatches">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
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
          >
            <span className="pt-hl">H</span>
          </button>
          {menu === "highlight" && (
            <div className="tb-menu-list pt-swatches">
              {HIGHLIGHTS.map((c) => (
                <button
                  key={c.label}
                  type="button"
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
        {Btn("Link", editor.isActive("link"), setLink, "Insert or edit link")}
        {Btn("Divider", false, () => chain().setHorizontalRule().run(), "Horizontal rule")}
        {Btn("Clear", false, () => chain().unsetAllMarks().run(), "Clear formatting")}
      </div>

      <div className="toolbar-group">
        <div className="tb-menu" ref={menu === "export" ? menuRef : undefined}>
          <button
            type="button"
            className={"tb-btn" + (menu === "export" ? " tb-btn-active" : "")}
            onClick={() => setMenu((m) => (m === "export" ? null : "export"))}
            title="Export this document"
          >
            Export
          </button>
          {menu === "export" && (
            <div className="tb-menu-list">
              <button type="button" className="tb-menu-item" onClick={() => { onExport("markdown"); setMenu(null); }}>
                Markdown
              </button>
              <button type="button" className="tb-menu-item" onClick={() => { onExport("txt"); setMenu(null); }}>
                Plain text
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
