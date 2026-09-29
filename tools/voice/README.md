# Voice: the Mac side

## Voice notes in documents (since 2026-09-28)

Arjun records inside any ordinary LESS document: the Record button in the
document toolbar, a waveform bar across the top of the page while it records,
and a card in the text where the note goes. The audio uploads to the server
under the note's own id (KV, via `PUT /api/assets/<id>`, rules in
`lib/server/assets.ts`). Nothing is transcribed in the cloud: transcription
waits for a Claude Code session on this Mac.

When he says **"process the voice notes"**:

    set -a
    source ../secrets/cloudflare.env
    source ../secrets/less-voice.env
    set +a
    npm run -s voice -- notes                  # every note waiting, and whether its audio is up
    npm run -s voice -- transcribe <noteId>    # download + whisper large-v3-turbo, prints raw
    npm run -s voice -- deliver-note <docId> <noteId> <raw.txt> <clean.txt> [--duration-ms N]

1. `notes` lists each waiting note with its document. `audio: null` means the
   recording is still on the device that made it (it uploads the next time
   LESS is open there with a connection): skip it and say so.
2. `transcribe` downloads the recording, converts it with ffmpeg and runs
   `whisper-cli` with `ggml-large-v3-turbo.bin` plus the Silero VAD model
   (`ggml-silero-v5.1.2.bin`, keeps whisper from inventing words in silences),
   both in `Arjun Health/models/`. It writes `raw.txt` (the word-for-word
   transcript, paragraphs at long pauses) into a working folder in the temp
   directory and prints it. A minute of speech takes a few seconds.
   `--lang xx` for another language, `--prompt "..."` to seed names.
3. Write `clean.txt` by the rules below.
4. `deliver-note` swaps the card for the transcribed note: the cleaned text as
   ordinary editable paragraphs, the original kept in the note (its
   "Original" button). For a note listed as `unfinished` (the tab closed
   mid-recording, so no length was stored) pass `--duration-ms` from step 2.
   Exit 3 means the document changed while you worked: run it again.

An open document picks the transcript up within about 20 seconds (or when its
tab regains focus). Unsent typing in that document at that moment is not lost:
the app moves it into History and says so.

### Cleanup rules

- Remove fillers (um, uh, "like" and "you know" used as filler), false starts,
  stutters and words said twice by accident.
- Fix punctuation and capitalization; start a new paragraph where the thought
  changes.
- Never add, reword, reorder or summarize. His words, in his order. When he
  corrects himself mid-sentence ("on Tuesday, no, Wednesday"), keep the
  correction and drop only the abandoned words of that same sentence.
- Keep names, slang, profanity and deliberate repetition.
- A dictated list may be written as `- item` lines; it becomes a bulleted list.
- Fix a plainly misheard word only when the document makes the intended one
  certain (a character name already in it). Tell him about anything doubtful.
- Nothing usable (silence, a pocket recording): do not deliver; tell him.

---

# Voice scripts (the older path)

## The workflow that stuck (2026-09-16)

Record a voice memo on the phone or the laptop, drop the file into
`~/Desktop/voice memo clone/`, and tell Claude in a Claude Code session.
Claude then:

1. transcribes it locally (`whisper-cli`, `small.en`, models in
   `Arjun Health/models/`; see the helper pattern in the session scratchpad),
2. reads the whole transcript and puts the genuine judgment calls to Arjun
   (camera language, an unattributed line, a wavering location or time),
3. writes the scene as Fountain-shaped lines under the rules below,
4. runs `npm run -s voice -- script "<title>" scene.fountain`, which parses
   it with the app's own `parseFountain` + `linesToDoc` and INSERTs a real
   screenplay row; the browser adopts it on its next sync.

Later passes on the same piece: `script --append <scriptId> scene.fountain`
adds the new lines to the end of a screenplay this worker created (listed in
`created.json`, the only screenplays it may touch). The in-app Record and
Process buttons are the older path and are not needed for this.

`npm run voice` runs under plain Node with `register.mjs`, which resolves the
app's `@/` alias and extensionless relative imports, so the worker shares the
app's modules rather than carrying copies.


A voice script is a LESS document (`type = "voice"`) the writer dictates or
types into, then hands to Claude with the Process button. LESS is a static
site and cannot call this machine, so the request travels as a line of text
(`/// PROCESS`) inside the document, through the ordinary cloud sync, into D1.
This folder is what notices it and answers.

The document is the state machine. See `lib/voice/markers.ts` for the states
and why they live in the text rather than in a column.

## Run

    set -a
    source ../secrets/cloudflare.env
    source ../secrets/less-voice.env
    set +a
    npm run -s voice -- selftest      # auth + endpoint, writes nothing
    npm run -s voice -- poll          # JSON list of notes waiting on Process
    npm run -s voice -- claim <id>    # /// PROCESS -> /// WORKING (the liveness signal)
    npm run -s voice -- deliver <id> formatted.txt
    npm run -s voice -- fail <id> "what went wrong"
    npm run -s voice -- seed <id> transcript.txt   # audio transcribed here -> note

`seed` is for the case where the browser could not record (no speech API,
or a blocked mic) and the words arrived as an audio file instead. Transcribe
locally (`whisper-cli`, models in `Arjun Health/models/`), then `seed` puts
the transcript into an EMPTY voice note as the writer's raw lines plus a
Process request, so `claim` and `deliver` run exactly as for dictation and
the note ends up in the same shape. It refuses a note that already holds
words.

`formatted.txt` is the structured result as plain screenplay lines, one per
paragraph. `deliver` appends it above the writer's original words and a
`/// PROCESSED <timestamp>` boundary; the next Process only sees words dictated
after that boundary.

## Rules the script enforces

- Only rows with `type = 'voice'`. Every statement carries the filter. A
  screenplay cannot be touched by this code path.
- Only the account in `LESS_VOICE_USER_ID`. LESS has other users.
- Every write is conditional on the `updated_at` it read. Exit code 3 means
  the writer edited the note while Claude was thinking: re-read and redo.
  This exists because a locally-dirty browser pushes and ignores the cloud
  (`lib/storage/useCloudSync.ts`), so a blind write would be overwritten and
  a blind read could miss words.

## Rules for whoever is doing the structuring

The structuring is done by Claude in a Claude Code session on this Mac, not
by an API call. The contract with the writer:

- Reorder, split, cut and format their words. Do not add content words. The
  only new text is structural: `INT.`/`EXT.`, a dash and time of day, a
  character cue for a name they said, a transition they asked for.
- Never invent a location or a character. Where a slugline cannot be written
  from what was said, leave `INT. [LOCATION?] - [TIME?]` for them to fill.
- Latest statement wins when they change their mind mid-note, and the
  superseded words stay in the `/// RAW` block underneath. Nothing they said
  is deleted, ever.
- Output plain Fountain-shaped lines: sluglines in caps, character cues in
  caps on their own line, dialogue beneath, parentheticals in brackets.
