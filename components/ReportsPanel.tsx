"use client";

import { useMemo } from "react";
import type { Outline } from "@/types/screenplay";
import { buildReport, reportToText } from "@/lib/editor/report";
import { downloadBlob, safeFilename } from "@/lib/export/download";

/**
 * The reports panel: production statistics plus scene, character, and location
 * breakdowns, all from the live outline and the real page count. Click a scene
 * to jump there; Export downloads a plain-text report.
 */
export function ReportsPanel({
  outline,
  pageCount,
  wordCount,
  title,
  onJump,
  onClose,
}: {
  outline: Outline;
  pageCount: number;
  wordCount: number;
  title: string;
  onJump: (pos: number) => void;
  onClose: () => void;
}) {
  const report = useMemo(
    () => buildReport(outline, pageCount, wordCount),
    [outline, pageCount, wordCount]
  );

  const onExport = () => {
    downloadBlob(
      reportToText(report, title),
      safeFilename(title + " report", "txt"),
      "text/plain;charset=utf-8"
    );
  };

  const s = report.stats;

  return (
    <aside className="side-panel reports-panel">
      <div className="side-panel-head">
        <strong>Reports</strong>
        <button type="button" className="side-panel-x" onClick={onClose} title="Close">
          Close
        </button>
      </div>

      <div className="report-stats">
        <div className="report-stat">
          <span className="report-stat-n">{s.pages}</span>
          <span className="report-stat-l">{s.pages === 1 ? "page" : "pages"} (~{s.runtimeMin} min)</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-n">{s.scenes}</span>
          <span className="report-stat-l">{s.intCount} INT / {s.extCount} EXT</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-n">{s.speakingCharacters}</span>
          <span className="report-stat-l">characters</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-n">{s.locations}</span>
          <span className="report-stat-l">locations</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-n">{s.words.toLocaleString()}</span>
          <span className="report-stat-l">words</span>
        </div>
      </div>

      <button type="button" className="tb-btn report-export" onClick={onExport}>
        Export report
      </button>

      <div className="report-section-title">Scenes</div>
      {report.scenes.length === 0 ? (
        <div className="side-panel-empty">No scenes yet.</div>
      ) : (
        <ul className="side-panel-list">
          {report.scenes.map((sc) => {
            const pos = outline.scenes.find((x) => x.number === sc.number)?.pos;
            return (
              <li key={sc.number} className="report-row">
                <button
                  type="button"
                  className="report-scene"
                  onClick={() => pos != null && onJump(pos)}
                  title={sc.heading}
                >
                  <span className="report-scene-n">{sc.number}</span>
                  <span className="report-scene-h">{sc.heading || "(untitled scene)"}</span>
                  {sc.page != null && <span className="report-scene-p">p. {sc.page}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="report-section-title">Characters</div>
      {report.characters.length === 0 ? (
        <div className="side-panel-empty">No speaking characters yet.</div>
      ) : (
        <ul className="side-panel-list">
          {report.characters.map((c) => (
            <li key={c.name} className="report-row">
              <span className="report-name">{c.name}</span>
              <span className="report-metrics">
                {c.lines} {c.lines === 1 ? "line" : "lines"}, {c.scenes} {c.scenes === 1 ? "scene" : "scenes"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="report-section-title">Locations</div>
      {report.locations.length === 0 ? (
        <div className="side-panel-empty">No locations yet.</div>
      ) : (
        <ul className="side-panel-list">
          {report.locations.map((l) => (
            <li key={l.name} className="report-row">
              <span className="report-name">{l.name}</span>
              <span className="report-metrics">
                {l.scenes} {l.scenes === 1 ? "scene" : "scenes"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
