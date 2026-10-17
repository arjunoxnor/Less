"use client";

import { memo } from "react";
import type { CoverDigest } from "@/lib/cover/digest";
import type { DocKind } from "@/lib/cover/kinds";
import {
  artFor,
  ART_H,
  ART_W,
  hashString,
  paletteFor,
  readableOn,
  seeded,
  stickyFor,
  type Shape,
} from "@/lib/cover/palette";

/**
 * A document's cover: coded graphic design, drawn from the document itself.
 * One composition per kind, so you can tell a script from a one-pager from a
 * beat sheet at a glance, before reading a word:
 *
 *   script      a title page on a colored jacket, Courier, "Written by"
 *   treatment   an editorial page: a big serif initial and the opening prose
 *   one-pager   a poster: one bold shape and the logline
 *   outline     index cards pinned to the board, one beat each
 *   characters  portrait medallions with the characters' initials
 *   notes       a sticky note
 *   document    a plain page with a folded corner
 *   board       the board's own images, collaged
 *   voice note  the recording's waveform
 *
 * Colors and shapes are seeded from the id: unique per document, identical on
 * every device, nothing stored. Text sizes are in container units (cqw), so
 * the same cover renders at any size, from a sidebar mosaic to the hero.
 */

export interface CoverProps {
  id: string;
  /** What the colors are seeded from: the stack, so versions match. Defaults to the id. */
  seed?: string;
  title: string;
  kind: DocKind;
  digest?: CoverDigest;
  author?: string;
  pageCount?: number;
  /** The folder's color, as a thin spine down the left edge. */
  spine?: string;
  /** Tiny render (mosaics): keep the shapes and big type, drop small text. */
  mini?: boolean;
}

function ShapeSvg({ s }: { s: Shape }) {
  switch (s.t) {
    case "circle":
      return <circle cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} />;
    case "ring":
      return <circle cx={s.cx} cy={s.cy} r={s.r} fill="none" stroke={s.stroke} strokeWidth={s.w} />;
    case "half":
      return (
        <path
          d={`M ${s.cx - s.r} ${s.cy} A ${s.r} ${s.r} 0 0 1 ${s.cx + s.r} ${s.cy} Z`}
          fill={s.fill}
          transform={`rotate(${s.rot} ${s.cx} ${s.cy})`}
        />
      );
    case "quarter": {
      const cx = s.corner === 1 || s.corner === 2 ? ART_W : 0;
      const cy = s.corner === 2 || s.corner === 3 ? ART_H : 0;
      return <circle cx={cx} cy={cy} r={s.r} fill={s.fill} />;
    }
    case "bar":
      return (
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          fill={s.fill}
          transform={`rotate(${s.rot} ${s.x + s.w / 2} ${s.y + s.h / 2})`}
        />
      );
    case "dots": {
      const dots = [];
      for (let i = 0; i < s.cols; i++)
        for (let j = 0; j < s.rows; j++)
          dots.push(<circle key={`${i}-${j}`} cx={s.x + i * s.gap} cy={s.y + j * s.gap} r={s.r} fill={s.fill} />);
      return <g opacity={0.55}>{dots}</g>;
    }
    case "tri":
      return <polygon points={s.points} fill={s.fill} />;
  }
}

function Art({ shapes }: { shapes: Shape[] }) {
  return (
    <svg className="cv-art" viewBox={`0 0 ${ART_W} ${ART_H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {shapes.map((s, i) => (
        <ShapeSvg key={i} s={s} />
      ))}
    </svg>
  );
}

/** "MAYA ROSE" -> "MR", "the lighthouse keeper" -> "TL". */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function decodePeaks(peaks: string, count: number, seed: string): number[] {
  const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
  const raw = [...peaks].map((ch) => Math.max(0, DIGITS.indexOf(ch)) / 35);
  if (raw.length >= 4) {
    return Array.from({ length: count }, (_, i) => raw[Math.floor((i * raw.length) / count)]);
  }
  // No recording data yet: a calm, seeded shape that still reads as a waveform.
  const r = seeded(hashString(seed));
  return Array.from({ length: count }, (_, i) => 0.25 + 0.55 * Math.abs(Math.sin(i * 0.7 + r() * 2)) * r());
}

const fallbackText = (d?: CoverDigest) => d?.logline ?? d?.lines?.[0] ?? "";

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/**
 * A plain document's title is often its own first line, so a cover would say
 * it twice. Drop a line that is only the title again (or what a long title
 * was cut from).
 */
function withoutTitle(lines: readonly string[], title: string): string[] {
  const t = squash(title.replace(/…$/, ""));
  return lines.filter((line) => {
    const l = squash(line);
    return !(l === t || (t.length >= 20 && l.startsWith(t)));
  });
}

function CoverInner({ id, seed, title, kind, digest, author, pageCount, spine, mini }: CoverProps) {
  const p = paletteFor(seed ?? id);
  const name = title.trim() || "Untitled";
  const ownLines = withoutTitle(digest?.lines ?? [], name);
  const shapes = kind === "board" || kind === "notes" ? [] : artFor(id, kind, p);
  const style = {
    ["--cv-bg" as string]: kind === "notes" ? stickyFor(seed ?? id) : p.bg,
    ["--cv-ink" as string]: kind === "notes" ? "#1F1C18" : p.ink,
    ["--cv-accent" as string]: p.accent,
    ["--cv-alt" as string]: p.alt,
  } as React.CSSProperties;

  let body: React.ReactNode;
  switch (kind) {
    case "script": {
      const scenes = digest?.scenes;
      body = (
        <>
          <div className="cv-sheet">
            <div className="cv-sheet-title">{name}</div>
            {author ? (
              <>
                <div className="cv-sheet-by">Written by</div>
                <div className="cv-sheet-author">{author}</div>
              </>
            ) : null}
            {digest?.firstScene && <div className="cv-sheet-foot">{digest.firstScene}</div>}
          </div>
          <div className="cv-jacket-foot">
            {pageCount ? <span>{pageCount} pp</span> : null}
            {scenes ? <span>{scenes} {scenes === 1 ? "scene" : "scenes"}</span> : null}
          </div>
        </>
      );
      break;
    }
    case "treatment": {
      const prose = ownLines.join(" ");
      body = (
        <>
          <div className="cv-eyebrow">Treatment</div>
          <div className="cv-initial" aria-hidden="true">
            {name.replace(/^(the|a|an)\s+/i, "").slice(0, 1).toUpperCase()}
          </div>
          <div className="cv-title cv-serif">{name}</div>
          {prose && <div className="cv-prose">{prose}</div>}
        </>
      );
      break;
    }
    case "onepager": {
      const line = digest?.logline ?? ownLines[0];
      body = (
        <>
          <div className="cv-eyebrow">One-pager</div>
          <div className="cv-logline">{line ? `“${line}”` : name}</div>
          {line && <div className="cv-foot">{name}</div>}
        </>
      );
      break;
    }
    case "outline": {
      // Beats: real headings when there are enough of them, else the list
      // items under a few act headings, else the opening lines.
      const heads = digest?.headings ?? [];
      const items = digest?.items ?? [];
      const beats = (heads.length >= 3 || !items.length ? (heads.length ? heads : digest?.lines ?? []) : items).slice(0, 6);
      const r = seeded(hashString(id + ":cards"));
      const cards = Array.from({ length: 6 }, (_, i) => ({
        text: beats[i] ?? "",
        tilt: (r() - 0.5) * 6,
        stripe: i % 2 ? "var(--cv-alt)" : "var(--cv-accent)",
      }));
      body = (
        <>
          <div className="cv-title cv-title-top cv-serif">{name}</div>
          <div className="cv-cards">
            {cards.map((c, i) => (
              <div key={i} className="cv-card" style={{ transform: `rotate(${c.tilt}deg)`, ["--stripe" as string]: c.stripe }}>
                {c.text}
              </div>
            ))}
          </div>
        </>
      );
      break;
    }
    case "characters": {
      const names = (digest?.headings?.length ? digest.headings : digest?.items ?? []).slice(0, 3);
      const faces = names.length ? names : [name];
      body = (
        <>
          <div className="cv-eyebrow">Characters</div>
          <div className={"cv-faces cv-faces-" + faces.length}>
            {faces.map((n, i) => (
              <div
                key={i}
                className={"cv-face cv-face-" + i}
                style={{
                  background: i === 1 ? p.alt : i === 2 ? p.ink : p.accent,
                  color: readableOn(i === 1 ? p.alt : i === 2 ? p.ink : p.accent),
                }}
              >
                <span>{initials(n)}</span>
              </div>
            ))}
          </div>
          <div className="cv-face-names">{faces.join(" · ")}</div>
          <div className="cv-foot">{name}</div>
        </>
      );
      break;
    }
    case "notes": {
      const lines = ownLines.length ? ownLines : withoutTitle(digest?.items ?? [], name);
      body = (
        <>
          <div className="cv-tape" aria-hidden="true" />
          <div className="cv-note-title">{name}</div>
          <div className="cv-note-lines">{lines.join(" ")}</div>
        </>
      );
      break;
    }
    case "board": {
      const images = digest?.images ?? [];
      const swatches = digest?.swatches ?? [];
      body = (
        <>
          {images.length > 0 ? (
            <div className={"cv-collage cv-collage-" + Math.min(images.length, 4)}>
              {images.slice(0, 4).map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
              ))}
            </div>
          ) : swatches.length > 0 ? (
            <div className="cv-swatches">
              {swatches.map((hex, i) => (
                <span key={i} style={{ background: hex }} />
              ))}
            </div>
          ) : (
            <div className="cv-mosaic" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => {
                const r = seeded(hashString(id + ":m" + i))();
                const c = r < 0.4 ? p.bg : r < 0.65 ? p.accent : r < 0.85 ? p.alt : p.ink;
                return <span key={i} style={{ background: c }} />;
              })}
            </div>
          )}
          <div className="cv-band">{name}</div>
        </>
      );
      break;
    }
    case "voice": {
      const bars = decodePeaks(digest?.voice?.peaks ?? "", 24, id);
      const said = digest?.voice?.transcribed ? fallbackText(digest) : "";
      body = (
        <>
          <div className="cv-eyebrow">Voice note</div>
          <div className="cv-wave" aria-hidden="true">
            {bars.map((h, i) => (
              <span key={i} style={{ height: `${12 + h * 78}%` }} />
            ))}
          </div>
          {digest?.voice?.ms ? <div className="cv-dur">{formatMs(digest.voice.ms)}</div> : null}
          {said ? <div className="cv-say">{said}</div> : <div className="cv-foot">{name}</div>}
        </>
      );
      break;
    }
    default: {
      const lines = ownLines;
      body = (
        <div className="cv-page">
          <div className="cv-page-title">{name}</div>
          {lines.length > 0 && <div className="cv-page-lines">{lines.join(" ")}</div>}
          <span className="cv-dogear" aria-hidden="true" />
        </div>
      );
    }
  }

  return (
    <div className={"cv cv-" + kind + (mini ? " cv-mini" : "")} style={style} aria-hidden="true">
      {shapes.length > 0 && <Art shapes={shapes} />}
      <div className="cv-body">{body}</div>
      {spine && <span className="cv-spine" style={{ background: spine }} />}
    </div>
  );
}

export const Cover = memo(CoverInner);
