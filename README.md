# LESS — Last Ever Screenwriting Software

A free, fast, web-based screenwriting app that respects your time and never holds
your scripts hostage. Simple, reliable, the opposite of bloated subscription
software that crashes.

## Status

**Phase 1 — Editor foundation (in progress).** The writing experience: the six
screenplay elements formatting correctly, smart Enter/Tab/Cmd-number behavior,
auto-uppercasing, a live page estimate, font + dark mode, focus mode, and
local-first autosave. No account required to start writing.

## Tech

- **Next.js 16** (App Router), deploys to Vercel
- **TipTap 3** (ProseMirror) editor; ProseMirror JSON is the source of truth
- **Supabase** for storage/auth (wired in Phase 2)

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # type-check without building
npm run build      # production build
```

## How the editor is built

| File | What it does |
| --- | --- |
| `lib/editor/elements.ts` | The element model: the six types, the Enter flow map, the Tab cycle, shortcut mappings. **Start here.** |
| `lib/editor/screenplayLine.ts` | The one block node. Every line carries an `element` attribute. |
| `lib/editor/keymap.ts` | Enter / Tab / Cmd-number behavior. |
| `lib/editor/autoCaps.ts` | Uppercases scene headings, character cues, transitions as you type. |
| `lib/editor/buildExtensions.ts` | Assembles the strict editor schema (no StarterKit). |
| `lib/storage/localStore.ts` | Local-first autosave + preferences. |
| `components/ScreenplayEditor.tsx` | Wires it all together: editor, autosave, page/word count. |
| `app/globals.css` | The screenplay page geometry (margins, indents, casing). |

## Keyboard

`Mod` = ⌘ on Mac, Ctrl on Windows/Linux.

| Key | Action |
| --- | --- |
| `Enter` | New line, type follows the flow (e.g. after a Character cue → Dialogue) |
| `Tab` / `Shift+Tab` | Cycle the current line's element type forward / back |
| `Mod+1` | Scene heading |
| `Mod+2` | Action |
| `Mod+3` | Character |
| `Mod+4` | Dialogue |
| `Mod+5` | Parenthetical |
| `Mod+6` | Transition |
| `Esc` | Exit focus mode |

## Roadmap

1. **Editor foundation** ← here
2. Save / auth (Supabase, RLS) + version history
3. Export: PDF, Fountain (in/out), FDX (in)
4. Navigation: scene navigator, autocomplete, find & replace, cast list
5. Real pagination (orphan rules, (MORE)/(CONT'D))
6. Later: real-time collaboration (architected for, not built)
