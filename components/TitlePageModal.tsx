"use client";

import { useState } from "react";
import { trimTitlePage, type TitlePage } from "@/lib/export/titlePage";
import { Modal } from "./ui/Modal";

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
  // Today, the way a title page writes it, as the example for the draft date.
  const [today] = useState(() =>
    new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  );

  const field = (key: keyof TitlePage) => (e: { target: { value: string } }) =>
    setTp((prev) => ({ ...prev, [key]: e.target.value }));

  const save = () => {
    onSave(trimTitlePage(tp) ?? {});
  };

  return (
    <Modal
      title="Title page"
      onClose={onClose}
      actions={[
        { label: "Cancel", onClick: onClose },
        { label: "Save", variant: "solid", onClick: save },
      ]}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            save();
          }
        }}
      >
        <p className="modal-sub">
          These appear on a title page when you export. Leave fields blank to
          skip them; clear them all for no title page.
        </p>

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
              placeholder="Based on the novel by…"
            />
        </label>
        <label className="field">
            <span>Draft date</span>
            <input
              value={tp.draftDate ?? ""}
              onChange={field("draftDate")}
              placeholder={today}
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
      </form>
    </Modal>
  );
}
