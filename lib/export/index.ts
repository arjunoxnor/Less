import type { JSONContent } from "@tiptap/core";
import { deriveTitle } from "@/lib/editor/docUtils";
import { docToLines, linesToDoc } from "./flatten";
import { downloadBlob, safeFilename } from "./download";
import { toFountain, parseFountain } from "./fountain";
import { parseFdx } from "./fdx";
import { exportPdf } from "./pdf";

/**
 * The one module the UI talks to. Components call exportDoc / importFile and
 * never need to know about MIME types, file extensions, or any individual
 * format module.
 */

export type ExportFormat = "pdf" | "fountain";
export type ImportFormat = "fountain" | "fdx";

/** Export the current document to a downloaded file in the given format. */
export async function exportDoc(doc: JSONContent, format: ExportFormat): Promise<void> {
  const lines = docToLines(doc);
  const title = deriveTitle(doc);

  if (format === "pdf") {
    const bytes = await exportPdf(lines);
    // Copy into a plain ArrayBuffer: pdf-lib types its output as
    // Uint8Array<ArrayBufferLike>, which BlobPart will not accept directly.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    downloadBlob(buffer, safeFilename(title, "pdf"), "application/pdf");
    return;
  }

  // fountain
  const text = toFountain(lines);
  downloadBlob(text, safeFilename(title, "fountain"), "text/plain;charset=utf-8");
}

/**
 * Read a user-picked file and return a ready-to-load ProseMirror doc. Routes by
 * file extension. Throws a plain-English Error the UI can surface directly.
 */
export async function importFile(file: File): Promise<JSONContent> {
  const name = file.name.toLowerCase();
  const text = await file.text();

  let lines;
  if (name.endsWith(".fdx") || name.endsWith(".xml")) {
    lines = parseFdx(text);
  } else if (
    name.endsWith(".fountain") ||
    name.endsWith(".txt") ||
    name.endsWith(".spmd")
  ) {
    lines = parseFountain(text);
  } else {
    throw new Error(
      "Unsupported file type. Choose a Fountain (.fountain, .txt) or Final Draft (.fdx) file."
    );
  }

  if (!lines.length) {
    throw new Error("That file did not contain any screenplay lines.");
  }

  return linesToDoc(lines);
}
