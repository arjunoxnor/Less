"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { getScriptPlace, setScriptPlace } from "@/lib/cloud/scripts";
import { placeAt, resolvePlace, type Place } from "@/lib/editor/returnPlace";
import { loadPlace, savePlace } from "@/lib/storage/projects";

/**
 * A script or document reopens where the writer left it: the caret back on
 * the line they were on, that line where it sat on the screen. Remembered on
 * this device at once and on the server shortly after (when signed in), so
 * the other computer opens on the same page. If the other computer was there
 * more recently, its place wins, unless the writer has already started moving
 * around here.
 *
 * What is remembered is the caret if it is on screen, otherwise the line
 * being read (a writer who scrolled on to read page 40 comes back to page 40).
 */
export function useReturnPlace(
  editor: Editor | null,
  projectId: string,
  opts: { enabled: boolean; cloud: boolean }
): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!editor || !opts.enabled) return;
    const view = editor.view;
    const scroller = () => view.dom.closest<HTMLElement>(".page-scroll");
    let moved = false; // the writer has done something since opening
    let restoring = true;
    let lastSaved = "";
    const timers: ReturnType<typeof setTimeout>[] = [];

    /** Put the caret at pos and bring its line to about a third of the way down. */
    const show = (pos: number) => {
      if (editor.isDestroyed) return;
      const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos)));
      view.dispatch(tr.setMeta("addToHistory", false));
      const place = () => {
        if (editor.isDestroyed || moved) return;
        const box = scroller();
        if (!box) return;
        try {
          const caret = view.coordsAtPos(view.state.selection.head);
          const frame = box.getBoundingClientRect();
          box.scrollTop += caret.top - frame.top - frame.height * 0.33;
        } catch {
          /* not laid out yet: the next try catches it */
        }
      };
      // The pages lay themselves out over the first moments: settle with them.
      requestAnimationFrame(() => requestAnimationFrame(place));
      timers.push(setTimeout(place, 350), setTimeout(place, 900));
    };

    /** Where the writer is now: the caret if it is in view, else the line being read. */
    const current = (): Place => {
      const box = scroller();
      const head = view.state.selection.head;
      if (box) {
        try {
          const frame = box.getBoundingClientRect();
          const caret = view.coordsAtPos(head);
          if (caret.top < frame.top || caret.bottom > frame.bottom) {
            const hit = view.posAtCoords({ left: frame.left + frame.width / 2, top: frame.top + frame.height * 0.33 });
            if (hit) return placeAt(view.state.doc, hit.pos);
          }
        } catch {
          /* fall back to the caret */
        }
      }
      return placeAt(view.state.doc, head);
    };

    const pushCloud = (place: Place, keepalive = false) => {
      if (!optsRef.current.cloud) return;
      void setScriptPlace(projectId, place, keepalive).catch(() => {
        /* the next save (or the next open) tries again */
      });
    };

    let localTimer: ReturnType<typeof setTimeout> | null = null;
    let cloudTimer: ReturnType<typeof setTimeout> | null = null;
    const remember = (now = false) => {
      if (restoring || editor.isDestroyed) return;
      const run = () => {
        const place = current();
        const key = JSON.stringify(place);
        if (key === lastSaved) return;
        lastSaved = key;
        savePlace(projectId, place);
        if (now) pushCloud(place, true);
        else {
          if (cloudTimer) clearTimeout(cloudTimer);
          cloudTimer = setTimeout(() => pushCloud(place), 2500);
        }
      };
      if (now) run();
      else {
        if (localTimer) clearTimeout(localTimer);
        localTimer = setTimeout(run, 800);
      }
    };

    // Open where this device last was, at once.
    const local = loadPlace(projectId);
    if (local) show(resolvePlace(view.state.doc, local.place));
    // Then ask the server: if another computer was here more recently, go
    // there instead (unless the writer has already moved); if this one is
    // newer, tell the server.
    let cancelled = false;
    if (opts.cloud) {
      void getScriptPlace(projectId)
        .then((cloud) => {
          if (cancelled || editor.isDestroyed) return;
          const cloudAt = cloud?.place_at ?? "";
          if (cloud?.place && cloudAt > (local?.at ?? "")) {
            savePlace(projectId, cloud.place, cloudAt);
            lastSaved = JSON.stringify(cloud.place);
            if (!moved) show(resolvePlace(view.state.doc, cloud.place));
          } else if (local && local.at > cloudAt) {
            pushCloud(local.place);
          }
        })
        .catch(() => {});
    }
    // Remembering starts once the restore has had its moment.
    timers.push(setTimeout(() => (restoring = false), 1200));

    // The editor may not be on the page yet when this starts, so its scroller
    // is looked up as events arrive (they are heard on the document).
    const inPage = (e: Event) => {
      const box = scroller();
      return !!box && e.target instanceof Node && (e.target === box || box.contains(e.target));
    };
    const onInput = (e: Event) => {
      if (inPage(e)) moved = true;
    };
    const onSelection = () => remember();
    const onScroll = (e: Event) => {
      if (e.target === scroller()) remember();
    };
    const onHide = () => remember(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") remember(true);
    };
    const listen = { capture: true, passive: true } as const;
    document.addEventListener("keydown", onInput, true);
    document.addEventListener("pointerdown", onInput, true);
    document.addEventListener("wheel", onInput, listen);
    document.addEventListener("touchstart", onInput, listen);
    document.addEventListener("scroll", onScroll, listen);
    editor.on("selectionUpdate", onSelection);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      // Leaving the document: remember exactly where, now.
      if (!restoring) remember(true);
      timers.forEach(clearTimeout);
      if (localTimer) clearTimeout(localTimer);
      if (cloudTimer) clearTimeout(cloudTimer);
      document.removeEventListener("keydown", onInput, true);
      document.removeEventListener("pointerdown", onInput, true);
      document.removeEventListener("wheel", onInput, listen);
      document.removeEventListener("touchstart", onInput, listen);
      document.removeEventListener("scroll", onScroll, listen);
      editor.off("selectionUpdate", onSelection);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [editor, projectId, opts.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
