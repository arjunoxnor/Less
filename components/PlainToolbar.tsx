"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { PlainExportFormat } from "@/lib/export/plainExport";

/**
 * Formatting toolbar for plain documents. Reuses the screenplay toolbar's
 * button styles. No element cycle, no Cmd+number, no screenplay panels.
 */
export function PlainToolbar({
  editor,
  onExport,
}: {
  editor: Editor | null;
  onExport: (format: PlainExportFormat) => void;
}) {
  // Re-render on every transaction so active states track the selection.
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [exportOpen, setExportOpen] = useState(false);
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
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

  if (!editor) return null;

  const chain = () => editor.chain().focus();
  const Btn = (
    label: string,
    active: boolean,
    onClick: () => void,
    title: string
  ) => (
    <button
      type="button"
      className={"tb-btn" + (active ? " tb-btn-active" : "")}
      onClick={onClick}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="toolbar-group">
        {Btn("B", editor.isActive("bold"), () => chain().toggleBold().run(), "Bold")}
        {Btn("I", editor.isActive("italic"), () => chain().toggleItalic().run(), "Italic")}
        {Btn("U", editor.isActive("underline"), () => chain().toggleUnderline().run(), "Underline")}
        {Btn("S", editor.isActive("strike"), () => chain().toggleStrike().run(), "Strikethrough")}
      </div>
      <div className="toolbar-group">
        {Btn("H1", editor.isActive("heading", { level: 1 }), () => chain().toggleHeading({ level: 1 }).run(), "Heading 1")}
        {Btn("H2", editor.isActive("heading", { level: 2 }), () => chain().toggleHeading({ level: 2 }).run(), "Heading 2")}
        {Btn("H3", editor.isActive("heading", { level: 3 }), () => chain().toggleHeading({ level: 3 }).run(), "Heading 3")}
      </div>
      <div className="toolbar-group">
        {Btn("List", editor.isActive("bulletList"), () => chain().toggleBulletList().run(), "Bullet list")}
        {Btn("1.", editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), "Numbered list")}
        {Btn("Quote", editor.isActive("blockquote"), () => chain().toggleBlockquote().run(), "Quote")}
        {Btn("Divider", false, () => chain().setHorizontalRule().run(), "Horizontal rule")}
      </div>
      <div className="toolbar-group">
        <div className="tb-menu" ref={menuRef}>
          <button
            type="button"
            className={"tb-btn" + (exportOpen ? " tb-btn-active" : "")}
            onClick={() => setExportOpen((v) => !v)}
            title="Export this document"
          >
            Export
          </button>
          {exportOpen && (
            <div className="tb-menu-list">
              <button
                type="button"
                className="tb-menu-item"
                onClick={() => {
                  onExport("markdown");
                  setExportOpen(false);
                }}
              >
                Markdown
              </button>
              <button
                type="button"
                className="tb-menu-item"
                onClick={() => {
                  onExport("txt");
                  setExportOpen(false);
                }}
              >
                Plain text
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
