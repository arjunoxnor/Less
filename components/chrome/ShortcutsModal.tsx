"use client";

import { Modal } from "../ui/Modal";

/**
 * The "?" overlay (Superaudit 2, 2D.4): a static two-column map of the whole
 * keyboard, grouped the way the app is grouped. Opened by pressing ? outside
 * a text field, or from the command palette.
 */

type Row = { keys: string; what: string };
type Section = { title: string; rows: Row[] };

function sections(mod: string): Section[] {
  return [
    {
      title: "Elements",
      rows: [
        { keys: "Tab / Shift+Tab", what: "Cycle the line type" },
        { keys: `${mod}1 .. ${mod}6`, what: "Set the line type directly" },
        { keys: `${mod}E`, what: "Open the line type menu" },
      ],
    },
    {
      title: "Flow",
      rows: [
        { keys: "Enter", what: "New line; the type follows the flow" },
        { keys: `${mod}D`, what: "Dual dialogue on the current cue" },
      ],
    },
    {
      title: "Panels",
      rows: [
        { keys: `${mod}F`, what: "Find and replace" },
        { keys: "Esc", what: "Close the open panel" },
      ],
    },
    {
      title: "Palette",
      rows: [
        { keys: `${mod}K`, what: "Command palette" },
        { keys: "?", what: "This overlay" },
      ],
    },
    {
      title: "Focus",
      rows: [
        { keys: "Esc", what: "Leave focus mode" },
        { keys: "Top of screen", what: "Reveal the top bar" },
      ],
    },
    {
      title: "Find",
      rows: [
        { keys: "Enter", what: "Next match" },
        { keys: "Esc", what: "Close find" },
      ],
    },
  ];
}

export function ShortcutsModal({
  mod,
  onClose,
}: {
  mod: string;
  onClose: () => void;
}) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcuts-grid">
        {sections(mod).map((s) => (
          <div key={s.title} className="shortcuts-section">
            <h3>{s.title}</h3>
            {s.rows.map((r) => (
              <div key={r.keys + r.what} className="shortcuts-row">
                <span className="shortcuts-keys">{r.keys}</span>
                <span>{r.what}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
