import type { JSONContent } from "@tiptap/core";
import type { ScriptLine } from "@/types/screenplay";
import { deriveTitle } from "@/lib/editor/docUtils";
import { docToLines, linesToDoc } from "./flatten";
import { downloadBlob, safeFilename } from "./download";
import { toFountain, parseFountain } from "./fountain";
import { parseFdx, toFdx } from "./fdx";
import { docxToLines, odtToLines, rtfToLines, looksBinary } from "./docImport";
import { exportPdf } from "./pdf";
import type { TitlePage } from "./titlePage";
import type { PageLock } from "./pageLock";

/**
 * The one module the UI talks to. Components call exportDoc / importFile and
 * never need to know about MIME types, file extensions, or any individual
 * format module.
 */

export type ExportFormat = "pdf" | "fountain" | "fdx";
export type ImportFormat = "fountain" | "fdx";

/**
 * The file extensions the importer accepts, for a file picker's `accept`. Kept
 * here next to importFile so the picker and the parser never drift apart.
 */
export const IMPORT_ACCEPT =
  ".docx,.odt,.rtf,.fdx,.fountain,.txt,.text,.md,.markdown,.spmd,.xml";

/**
 * Clear the dual flag on any imported cue cluster that has no left-column
 * partner (a preceding non-dual character cue), so imported documents satisfy
 * the same invariant the editor's toggleDual enforces. A dual right column only
 * makes sense paired with a left one.
 */
function normalizeDual(lines: ScriptLine[]): ScriptLine[] {
  const isBody = (l: ScriptLine) =>
    l.element === "parenthetical" || l.element === "dialogue";
  const out = lines.map((l) => ({ ...l }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].element !== "character" || !out[i].dual) continue;
    let j = i - 1;
    while (j >= 0 && isBody(out[j])) j--;
    const hasLeft = j >= 0 && out[j].element === "character" && !out[j].dual;
    if (!hasLeft) {
      delete out[i].dual;
      for (let k = i + 1; k < out.length && isBody(out[k]); k++) delete out[k].dual;
    }
  }
  return out;
}

/** Export the current document (and optional title page) to a downloaded file. */
export async function exportDoc(
  doc: JSONContent,
  format: ExportFormat,
  titlePage?: TitlePage | null,
  opts?: { sceneNumbers?: boolean; autoContd?: boolean; lock?: PageLock | null }
): Promise<void> {
  const lines = docToLines(doc);
  const title = deriveTitle(doc);

  if (format === "pdf") {
    const bytes = await exportPdf(lines, titlePage, opts);
    // Copy into a plain ArrayBuffer: pdf-lib types its output as
    // Uint8Array<ArrayBufferLike>, which BlobPart will not accept directly.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    downloadBlob(buffer, safeFilename(title, "pdf"), "application/pdf");
    return;
  }

  if (format === "fdx") {
    const xml = toFdx(lines, titlePage);
    downloadBlob(xml, safeFilename(title, "fdx"), "application/xml;charset=utf-8");
    return;
  }

  // fountain
  const text = toFountain(lines, titlePage);
  downloadBlob(text, safeFilename(title, "fountain"), "text/plain;charset=utf-8");
}

/**
 * Read a user-picked file and return a ready-to-load ProseMirror doc plus any
 * title page it carried. Routes by file extension. Throws a plain-English Error
 * the UI can surface directly.
 */
export async function importFile(
  file: File
): Promise<{ doc: JSONContent; titlePage: TitlePage | null }> {
  const name = file.name.toLowerCase();

  let lines: ScriptLine[];
  let titlePage: TitlePage | null = null;

  if (name.endsWith(".fdx") || name.endsWith(".xml")) {
    const r = parseFdx(await file.text());
    lines = r.lines;
    titlePage = r.titlePage;
  } else if (name.endsWith(".docx")) {
    lines = await docxToLines(await file.arrayBuffer());
  } else if (name.endsWith(".odt")) {
    lines = await odtToLines(await file.arrayBuffer());
  } else if (name.endsWith(".rtf")) {
    lines = rtfToLines(await file.text());
  } else if (name.endsWith(".doc")) {
    throw new Error(
      "Old .doc files are not supported. In Word, choose File then Save As and pick .docx or .rtf, then import that."
    );
  } else if (name.endsWith(".pages")) {
    throw new Error(
      "Apple Pages files are not supported. In Pages, choose File then Export To then Word, and import the .docx."
    );
  } else if (name.endsWith(".pdf")) {
    throw new Error(
      "PDF import is not supported yet. Export the script to .docx, .fdx, or .fountain and import that."
    );
  } else if (
    name.endsWith(".fountain") ||
    name.endsWith(".spmd") ||
    name.endsWith(".txt") ||
    name.endsWith(".text") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ) {
    const r = parseFountain(await file.text());
    lines = r.lines;
    titlePage = r.titlePage;
  } else {
    // Unknown extension: if it decodes as text, treat it as Fountain / plain
    // text; otherwise refuse rather than dumping binary into the editor.
    const text = await file.text();
    if (looksBinary(text)) {
      throw new Error(
        "Unsupported file type. Import a Word (.docx), Final Draft (.fdx), Fountain (.fountain, .txt), Rich Text (.rtf), or OpenDocument (.odt) file."
      );
    }
    const r = parseFountain(text);
    lines = r.lines;
    titlePage = r.titlePage;
  }

  if (!lines.length) {
    throw new Error("That file did not contain any text we could import.");
  }

  return {
    doc: linesToDoc(normalizeDual(lines)),
    titlePage,
  };
}
