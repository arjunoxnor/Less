"use client";

import { useEffect, useState } from "react";
import { trimTitlePage, type TitlePage } from "@/lib/export/titlePage";

/**
 * Editor for the screenplay title page. The values are metadata stored beside
 * the script, not screenplay body, and they appear as an unnumbered first page
 * on PDF export and as a Fountain title block.
 */
export function TitlePageModal({
  value,
  onSave,
  onClose,
}: {
  value: TitlePage;
  onSave: (tp: TitlePage) => void;
  onClose: () => void;
}) {
  const [tp, setTp] = useState<TitlePage>(value);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const field = (key: keyof TitlePage) => (e: { target: { value: string } }) =>
    setTp((prev) => ({ ...prev, [key]: e.target.value }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(trimTitlePage(tp) ?? {});
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">Title page</h2>
        <p className="modal-sub">
          These appear on a title page when you export. Leave fields blank to
          skip them; clear them all for no title page.
        </p>

        <form onSubmit={save}>
          <label className="field">
            <span>Title</span>
            <input value={tp.title ?? ""} onChange={field("title")} autoFocus />
          </label>
          <label className="field">
            <span>Credit</span>
            <input
              value={tp.credit ?? ""}
              onChange={field("credit")}
              placeholder="Written by"
            />
          </label>
          <label className="field">
            <span>Author</span>
            <input
              value={tp.author ?? ""}
              onChange={field("author")}
              placeholder="Name"
            />
          </label>
          <label className="field">
            <span>Source</span>
            <input
              value={tp.source ?? ""}
              onChange={field("source")}
              placeholder="Based on the novel by ..."
            />
          </label>
          <label className="field">
            <span>Draft date</span>
            <input
              value={tp.draftDate ?? ""}
              onChange={field("draftDate")}
              placeholder="June 19, 2026"
            />
          </label>
          <label className="field">
            <span>Contact</span>
            <textarea
              rows={3}
              value={tp.contact ?? ""}
              onChange={field("contact")}
              placeholder="Name, address, phone, email"
            />
          </label>
          <label className="field">
            <span>Copyright</span>
            <input value={tp.copyright ?? ""} onChange={field("copyright")} />
          </label>

          <button type="submit" className="modal-primary">
            Save
          </button>
        </form>

        <button type="button" className="modal-close" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
