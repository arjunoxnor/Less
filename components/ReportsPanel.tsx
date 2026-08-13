"use client";

import { memo, useMemo, useRef } from "react";
import type { Outline } from "@/types/screenplay";
import { buildReport, reportToText } from "@/lib/editor/report";
import { downloadBlob, safeFilename } from "@/lib/export/download";

/**
 * The reports panel: production statistics plus scene, character, and location
 * breakdowns, all from the live outline and the real page count. Click a scene
 * to jump there; Export downloads a plain-text report.
 */
export const ReportsPanel = memo(function ReportsPanel({
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
  const structuralReport = useMemo(
    () => buildReport(outline, pageCount, 0),
    [outline, pageCount]
  );
  const report = useMemo(
    () => ({
      ...structuralReport,
      stats: { ...structuralReport.stats, words: wordCount },
    }),
    [structuralReport, wordCount]
  );
  const scenePositions = useMemo(
    () => new Map(outline.scenes.map((scene) => [scene.number, scene.pos])),
    [outline.scenes]
  );
  const latestOutline = useRef(outline);
  const latestReport = useRef(report);
  const latestTitle = useRef(title);
  latestOutline.current = outline;
  latestReport.current = report;
  latestTitle.current = title;

  // Word count changes on nearly every keystroke. Keep the large structural
  // lists memoized so updating that one statistic does not rebuild thousands
  // of scene/cast/location row elements.
  const sceneRows = useMemo(
    () =>
      structuralReport.scenes.map((scene) => {
        const pos = scenePositions.get(scene.number);
        return (
          <li key={scene.number} className="report-row">
            <button
              type="button"
              className="report-scene"
              onClick={() => {
                const live = latestOutline.current.scenes.find(
                  (entry) =>
                    entry.number === scene.number && entry.heading === scene.heading
                );
                if (live) onJump(live.pos);
              }}
              disabled={pos == null}
              title={scene.heading}
            >
              <span className="report-scene-n">{scene.number}</span>
              <span className="report-scene-h">
                {scene.heading || "(untitled scene)"}
              </span>
              {scene.page != null && (
                <span className="report-scene-p">p. {scene.page}</span>
              )}
            </button>
          </li>
        );
      }),
    [onJump, scenePositions, structuralReport.scenes]
  );
  const characterRows = useMemo(
    () =>
      structuralReport.characters.map((character) => (
        <li key={character.name} className="report-row">
          <span className="report-name">{character.name}</span>
          <span className="report-metrics">
            {character.lines} {character.lines === 1 ? "line" : "lines"},{" "}
            {character.scenes} {character.scenes === 1 ? "scene" : "scenes"}
          </span>
        </li>
      )),
    [structuralReport.characters]
  );
  const locationRows = useMemo(
    () =>
      structuralReport.locations.map((location) => (
        <li key={location.name} className="report-row">
          <span className="report-name">{location.name}</span>
          <span className="report-metrics">
            {location.scenes} {location.scenes === 1 ? "scene" : "scenes"}
          </span>
        </li>
      )),
    [structuralReport.locations]
  );

  const onExport = () => {
    downloadBlob(
      reportToText(latestReport.current, latestTitle.current),
      safeFilename(latestTitle.current + " report", "txt"),
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
          {sceneRows}
        </ul>
      )}

      <div className="report-section-title">Characters</div>
      {report.characters.length === 0 ? (
        <div className="side-panel-empty">No speaking characters yet.</div>
      ) : (
        <ul className="side-panel-list">
          {characterRows}
        </ul>
      )}

      <div className="report-section-title">Locations</div>
      {report.locations.length === 0 ? (
        <div className="side-panel-empty">No locations yet.</div>
      ) : (
        <ul className="side-panel-list">
          {locationRows}
        </ul>
      )}
    </aside>
  );
}, (previous, next) =>
  previous.outline === next.outline &&
  previous.pageCount === next.pageCount &&
  previous.wordCount === next.wordCount &&
  previous.title === next.title &&
  previous.onJump === next.onJump
);
