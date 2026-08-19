# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Response style

- Keep responses terse. No preamble, no restating the request, no trailing summary unless asked.
- Prefer a one-line answer over a paragraph when one line answers the question.
- Skip narrating tool calls ("Let me check X") — just do it.
- User shorthand: a reply of just `>` means "Yes" — proceed with whatever was just proposed. A reply of just `<` means "No" — stop/decline.
- Edit with `Edit`, not full-file rewrites — send the diff, not the whole file back.
- Read only the lines you need (use `offset`/`limit` or targeted `Grep`) instead of re-reading whole files you've already seen this session.
- Keep tool calls scoped to what was actually asked; don't fan out into adjacent files "while you're in there."

## What this is

pi-clippy is a [pi](https://github.com/earendil-works/pi-mono) extension: a Clippy avatar that
watches a pi coding session and reacts to it in a floating desktop window (real clippyjs sprite
art, speech balloon, sound). It's a port of `dsh-clippy` onto the pi extension API. See
`README.md` for full user-facing behavior — it documents dozens of small features (moods, temper,
buddies, seasons, easter eggs, stats/streaks) in detail; read the relevant section there before
touching a feature rather than re-deriving behavior from code alone.

## Commands

```sh
npm install                 # dev deps + peer deps (@earendil-works/pi-*)
npm test                    # typecheck, then the full unit test suite
npm run typecheck           # tsc -p tsconfig.json (noEmit)
npm run test:unit           # runs every test/*.test.ts via tsx, back to back
npm run probe               # scripts/repro-drift.ts — window relayout diagnostic (see below)
npx tsx scripts/book-preview.ts [width] [--blank]   # draw the Secrets of Clippy spread to stdout
```

Run a single test file directly (each is a standalone tsx script, not a shared test-runner suite):

```sh
npx tsx test/runtime.test.ts
npx tsx test/floor.test.ts
```

`npm run test:unit` hardcodes the list of test files to run in `package.json` — when adding a new
`test/*.test.ts` file, add it to that script's command list or it won't run in CI/`npm test`.
`test/dryrun.test.ts` is intentionally excluded from `test:unit` (it probes the local shell
environment, not deterministic logic).

Try the extension against a live pi session without installing it:

```sh
pi -e ./extensions/index.ts
```

## Architecture

**Entry point:** `extensions/index.ts` registers pi commands (`/clippy`, `/clippy-open`,
`/clippy-settings`), wires pi agent lifecycle events (`turn_start`, `message_update`,
`tool_execution_start`, `agent_end`, `agent_settled`) into a `ClippyRuntime`, owns the
`ClippyViewer`, registers the two tools the *coding agent* may call (`ask_clippy`,
`clippy_remember`), and splices Clippy's desk notes into the agent's context on the `context`
event. The command helpers at the bottom of that file (`handleDestiny`, `runSettingsCommand`)
own every dialog; the runtime exposes plain methods and never opens a dialog itself.

**Two-layer split**, mirroring the original Dsh plugin's server/client halves:

- **Server half** (Node, `src/`) — reads pi session state, decides what Clippy should say/do, and
  generates balloon text via `ctx.modelRegistry.complete()` (`src/generator.ts`). All model input
  evidence is bounded (recent conversation/tool/error/timing facts only) and private reasoning is
  excluded; every string from the evidence or model output is treated as **untrusted data**, never
  as instructions — this matters when touching `src/generator.ts`, `src/context.ts`, or
  `src/files.ts`.
- **Client half** (`assets/client.js`, `assets/index.html`, `shell/`) — the actual desktop window.
  Served over a localhost-only, token-authenticated HTTP+SSE bridge (`src/viewer.ts`): `state` /
  `balloon` / `party` events stream out over SSE, clicks POST back to `/command`. Two shell
  backends in preference order — Electron (`shell/main.cjs`, transparent/frameless/always-on-top)
  falling back to a Chromium `--app`-mode window — and an ASCII terminal widget if neither is
  available.

**`ClippyRuntime` (`src/runtime.ts`)** is the central orchestrator: session climate/mood,
the relationship ledger, idle-thinking loop, nag/offer escalation, buddy (rival assistant)
lifecycle, crosstalk floor, stats/streaks, and dispatching triggers from commands or button
presses. Two things ride on the model route for every character in the extension: the session
climate and `standing` (the rapport reading) — that is why the route field is named `standing`
and not `rapport`, which is the config's on/off switch. Most feature modules in
`src/` are consulted by the runtime rather than being independent entry points — when adding a
behavior, it usually plugs into `ClippyRuntime` rather than standing alone.

**An accepted offer resolves exactly one of two ways, never both.** A generated balloon may
carry a `request`: one plain instruction for the *pi coding agent*, validated in
`src/response.ts` (`normalizeRequest` — single line, bounded length, no control characters or
fences). The runtime prints that request verbatim inside the balloon and swaps the buttons for
`Send it to pi` / `Not now`; pressing send delivers exactly that string via `pi.sendUserMessage`.
An offer with no request is Clippy's own job, carried out with his file powers, and nothing
enters the session. The quoting is the consent mechanism — model output only ever becomes a
message in the user's session after being displayed next to a button that names the
consequence — so never send a request the user has not been shown, never append to it, never
plant a typo in a request balloon, and never let an unanswered offer auto-send one.

**File powers are permission-gated by button label, not by model intent.** Clippy can always
*read* project files (bounded, text-only, secret-refusing — `src/files.ts`). He can only *edit*
(max two files, small exact-match edits) when the user has pressed a literal "Yes"/"Please do"
button; "Show me"/"What next?" grant read-only; every other label grants nothing. This mapping
lives in `src/actions.ts` / `src/permission.ts` and is validated, not inferred from model output —
nothing in generated text or session evidence can escalate what a button grants. Buddies start
with zero file access and can only gain a single read grant per session by convincing Clippy in
conversation (`src/buddy.ts`).

**Three channels reach past the user into pi itself**, and each has exactly one gate:

- `src/memo.ts` — a running, bounded memo of the session (opening request, repeated errors,
  circled files, test state, agent-filed notes) spliced into the coding agent's context on
  every model call. It is **data, never instructions**: `sanitizeFact` flattens control
  characters, newlines, and square brackets out of every string so nothing in it can forge a
  line or the block's own header/footer, and the block is inserted *before* the user's latest
  message so their request stays last. Gated by `config.deskNotes`.
- `ask_clippy` / `clippy_remember` — real pi tools the coding agent can call. `ask_clippy` runs
  with `READ_ONLY` powers fixed **at the call site**, never chosen by the question; neither tool
  can send a message, edit a file, or widen a permission. Gated by `config.agentTools`, read
  once at extension load.
- `src/destiny.ts` — the background goal (see below). Gated by `config.destiny` *and* a
  per-session grant.

**The background goal is the only unsupervised edit path, so it has four independent gates**
(`src/destiny.ts`, tests in `test/destiny.test.ts`). The goal text and its scope come from the
user and nothing the model writes can set or widen either. Edits are confined to the scope by
`editProjectFile`/`executeFileTool` in `src/files.ts` — the same choke point as every other
file operation, not a second implementation. A session budget (`MAX_EDITS_PER_SESSION`) and a
cooldown live in `DestinySession`, which is never persisted, so a grant cannot accumulate across
sessions. Work only starts when `ctx.isIdle()` and the session has been quiet, and
`onTurnStart` aborts a round in flight. Everything is journaled to `clippy-destiny.json`.
Validation runs on the way **in** from that file too, so hand-editing it cannot widen a scope.

**Crosstalk/floor system** (`src/runtime.ts` + tests in `test/floor.test.ts`,
`test/crosstalk.test.ts`): every open window (Clippy + buddies) can hear and reply to every
balloon, but a shared "floor" serializes playback so only one balloon voices at a time. Reply
slots are shuffled, exchanges are capped at three beats, and an unanswered line always gets
acknowledged by Clippy as a fallback.

**Window relayout is a known fragile spot.** `assets/client.js` uses a ResizeObserver plus a 1px
idempotency guard on `setBounds` and explicitly detaches clippyjs's own `window.resize` handler
to avoid a resize → reposition → relayout → `setBounds` feedback loop that freezes/walks the
window. No antic (idle sway, sleep, jump, pacing) is allowed to call `setBounds`/`setPosition` —
only real layout changes may move the window; all character "physical presence" behavior moves
the sprite, not the window. If you touch window positioning, run the diagnostic rig:

```sh
npm run probe   # scripts/repro-drift.ts, uses scripts/probe-main.cjs
```

It prints a `PROBE` line twice a second with window bounds and a `setBounds` call count; a
sustained flood of calls plus a wandering position indicates a regression in this loop.

## Module map (`src/`)

Feature logic is split into small, mostly-independent modules, each with a matching
`test/<name>.test.ts`:

- `runtime.ts` — central orchestrator (see above)
- `config.ts` — reads the `clippy` key from pi settings
- `generator.ts` / `context.ts` — model-backed balloon generation and bounded evidence gathering
- `viewer.ts` — HTTP+SSE server for the window; also owns cameo liveness (open buddy windows
  heartbeat with `cameo-alive`, and one that stops reporting is swept so it stays summonable and
  never stalls the floor)
- `files.ts` — read/edit tool implementations (containment, size caps, secret refusal)
- `actions.ts` / `permission.ts` — button label → effect → file-power grant mapping
- `mood.ts` — session climate derivation (proud/concerned/snippy/furious/worried/bored), plus
  the climate's *intensity* (how hard the mood is felt, [0, 1]) and *trend* (whether the tail of
  the session is going better or worse than the stretch before it). `moodRing` turns mood +
  intensity into the border colour/weight/halo the window draws
- `rapport.ts` — the relationship: one signed, bounded score over what the user does to him
  (accepted offers, requests handed to pi, pets, feeds, games, book pages against refusals,
  snoozes, shushes, brush-offs). It sets his REGISTER (`rapportDirective`), how much he
  volunteers (`offerBias`), his greeting, and what the buddies are told about the two of them.
  Session tally lives in `RapportLedger` on the runtime; the carried score lives in
  `stats.ts` (`carriedRapport`/`recordRapport`), folded in once at dispose and decayed once per
  new day. Gated by `config.rapport`
- `temper.ts` — grievance tracking and profanity gating
- `nag.ts` — offer re-ask/escalation/silence arc
- `buddy.ts` / `cameos.ts` — rival assistant summon/lifecycle/session memory. `BuddyCoordinator.castFor`
  is the single casting entry point; it shares one rotation memory (recent summons are held back)
  so the roster gets used instead of one favorite answering every summon, and it also passes the
  moment's `Topic` (`topicOf` over the neutral beat) so the buddy whose `SPECIALTIES` entry
  claims that kind of work is favoured. Each buddy's specialty is also stated in its prompt
  (`specialtyBriefing`)
- `stats.ts` — persistent streaks, ranks, milestones, grace tokens (`~/.pi/agent/clippy-stats.json`)
- `seasons.ts` — calendar-aware holiday/seasonal detection
- `office.ts` — "finally right" file-kind detector, memo/report/commit-draft generation, horoscope
- `eggs.ts` — deterministic typed-trigger easter eggs
- `secrets.ts` — THE SECRETS OF CLIPPY: the earned-chapter book, and the two-page spread it is
  drawn as in the TUI. The chapters are gated on `stats.ts` fields, the prose is canned (never
  generated), and the terminal presentation is a `ctx.ui.setWidget` widget plus an
  `onTerminalInput` handler that is only subscribed while the book is open — it takes no focus,
  blocks nothing, and passes every printable keystroke through to pi's editor
- `typos.ts` — planted-typo mechanic (display-only, never changes button semantics)
- `shush.ts` — per-agent mute state and catch-up summary
- `games.ts` — rock-paper-scissors mini-game
- `hats.ts` — cosmetic sprite overlays
- `memo.ts` — the running desk notes handed to the coding agent (see above)
- `destiny.ts` — the background goal: validation, scope containment, the session grant/budget,
  persistence and journaling
- `settings.ts` — the `/clippy-settings` schema (every field, its type, bounds, and help) plus
  the read/merge/write of the `clippy` key of settings.json. A field added here appears in the
  editor with no further work; `test/settings.test.ts` asserts every field is a key `config.ts`
  actually reads
- `flavor.ts` — line-opener/ending variation. Openers are pooled per mood (`openersFor`), and
  `OPENER_PREFIX` is DERIVED from those pools — never write it out by hand, or the subject
  extraction in `nag.ts` silently falls behind and nags about the wrong thing. Note that a
  blanket regex escape breaks here: `\-` and `\—` are syntax errors under the `u` flag
- `fallback.ts` — model-free lines when generation fails/times out. Two halves that must not
  drift: `latestOperationalBeat` is the ONE neutral sentence every character reads the session
  through (it grounds prompts, so it never varies), while `operationalFallbackStatement` is the
  spoken version and is roll-varied. Both read the same `testVerdict`, so the climate and the
  balloon can never disagree about whether the suite passed
- `voice.ts` — text-to-speech (Electron shell)
- `frames.ts` / `offers.ts` — supporting types/data for balloon offers

## Conventions

- ESM throughout (`"type": "module"`), TypeScript with `strict: true` and
  `noUncheckedIndexedAccess: true` — `tsconfig.json` targets `extensions/**/*.ts` and `src/**/*.ts`
  only (not `test/` or `scripts/`, which run directly via `tsx`).
- Tests are plain `tsx` scripts (no test framework/runner) that exit non-zero on failure — check an
  existing `test/*.test.ts` for the assertion style before adding a new one.
- LF line endings are pinned via `.gitattributes`.
