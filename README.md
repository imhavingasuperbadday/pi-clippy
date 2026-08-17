# pi-clippy

The earnest Microsoft Office Assistant, watching your [pi](https://github.com/earendil-works/pi-mono) coding session with alarming technical accuracy and offering completely misplaced Office help.

A pi extension port of [dsh-clippy](https://github.com/xlr8harder/dsh-clippy) (MIT). The original is a plugin for the DeepSeek Harness web client; this port maps its two halves onto the pi extension API:

| dsh-clippy | pi-clippy |
|---|---|
| Dsh `ctx.llm.stream()` balloon generation | `ctx.modelRegistry.complete()` (via `src/generator.ts`) |
| Dsh `SessionEvent` log evidence | pi session entries (`ctx.sessionManager.buildContextEntries()`, `src/context.ts`) |
| Browser sprite atlas (clippyjs, DOM) | **Clippy window** with the real clippyjs sprite art over a localhost SSE bridge (`src/viewer.ts`, `assets/`) — ASCII terminal widget fallback (`src/frames.ts`) |
| Client state channel (`Thinking`, `Writing`, `Searching`, …) | pi agent events (`turn_start`, `message_update`, `tool_execution_start`, `agent_end`, `agent_settled`) |
| `/clippy` Dsh command | `/clippy` pi extension command; clicking the Clippy window does the same |

## Install

From this directory (or anywhere on disk):

```sh
npm install          # installs clippyjs (sprite art) for the external window
pi install ./path/to/clippy        # persistent (writes to user settings)
pi -e ./extensions/index.ts        # try for one run only
```

`pi install` on a git source runs `npm install` automatically; for a local path install, run `npm install` in the package once.

## Use

When you start pi in TUI mode, Clippy appears as a **frameless, transparent, always-on-top desktop window** — just Clippy floating over your other apps, no window chrome and no browser. It's an Electron shell (`shell/main.cjs`) with the real clippyjs sprite animation:

- **Move it**: press and hold on Clippy (or the rim around him) and drag — he moves across the whole screen (the window follows him)
- **Ask it**: click Clippy, his dialog box, or anywhere in his window (same as `/clippy`)
- **Right-click an agent** (Clippy *and* every buddy) — the same context menu for all of them: *Ask / Explain last change / Suggest next step / Roast me / Wave*, a **Summon a buddy** submenu (spawn any configured buddy from any window), a **Turn off a buddy** submenu (close a currently-visible buddy; the session remembers who turned whom off), *Settings…* (opens `~/.pi/agent/settings.json`), and *Quit Clippy* (main window) / *Turn off <agent>* (that buddy).
- **Buddy system with session memory**: buddies argue with each other and *remember within the session* — who they argued with, who turned whom off, and being summoned back after a dismissal colors their lines. The memory lives on the runtime only and never persists across sessions. A repeat interrupter takes up residence (stops auto-dismissing), and with `annoyanceChance` Clippy tires of it and turns it off.
- **It answers mid-run**: a watchdog gives Clippy an interim balloon every couple of minutes during long stretches of agent activity (instead of silently “thinking” while the agent works), and errors get a priority reply even before the turn settles.
- **Commands**: `/clippy` ask, `/clippy party` animation parade, `/clippy stats` your numbers, `/clippy explain|suggest|roast`, `/clippy-open` reopen the window
- **Konami code**: ↑↑↓↓←→←→ B A summons Bonzi
- **It survives pi restarts**: the window stays put when pi exits (showing *pi is not running*), and reconnects automatically when pi starts again

- Clippy animates on agent state changes: `Thinking`, `Writing`, `Searching`, `Congratulate` (clean finish), `GetAttention` (errors), plus a `GestureUp` flourish every ~90–240 seconds. Real Clippy idle animations (blinks, snoozes, rope piles…) play between actions.
- Balloons use the classic typewriter speech bubble. **Auto commentary is event-driven**: when a turn settles, Clippy comments a few seconds later — right after a turn that produced errors, otherwise occasionally when the session gained new content. A cooldown stops nagging, bursts yield one balloon per quiet stretch, and unchanged sessions are never summarized twice. Generation is bounded to recent conversation, tool, error, and timing evidence; private reasoning is excluded.
- **Click Clippy** (or run `/clippy`) for an immediate conclusion — Clippy says it the way the real 90s paperclip would: simple, cheerful, occasionally rude, occasionally kind, occasionally gloriously stupid, and always sure that whatever you are doing is office work. When he asks a question, his own short words become the clickable buttons — he never asks something that cannot be answered. Malformed, exhausted, or timed-out output gets one simpler retry, then a structured test/file/tool fact, then a generic line.
- **The buttons really do things.** The words on a button decide what happens, so answering Clippy is a decision with an outcome rather than a formality (`src/actions.ts`):
  - `Yes` / `Please do` — the offer becomes a real request in the pi session, built from the balloon you just read (queued as a follow-up when the agent is mid-run).
  - `Show me` — he actually explains the most recent change. `What next?` — he actually proposes the next step. `Be honest` — the unvarnished version of how the session is going.
  - `Second opinion` / `Ask Bonzi` — he sends for that rival, who opens in its own window with an opinion about what he just said.
  - `Show my stats` reads the numbers out; `Party` throws the parade.
  - `No` / `Not now` starts the classic nag arc and is filed away against his temper; `Don't show this tip again` really silences the subject.
  Whatever the button, his reply is generated *about that choice on that offer*, so he answers the thing you actually pressed. **The effect always comes from the visible label** — nothing hidden in the model's output or in the session evidence can steer what lands in your session. Buddy buttons work exactly the same way, in that buddy's own voice.
- The window survives `/new` and `/resume`; reopen it anytime with `/clippy-open`. The terminal shows a small `clippy: <state>` footer line.

No window on your machine? The renderer falls back to an ASCII Clippy widget above the editor (see config below).

## Config

All keys are optional, under the `clippy` key of `~/.pi/agent/settings.json`:

```json
{
  "clippy": {
    "provider": "openrouter",     // model route override (default: session model)
    "model": "some/preset-or-model",
    "renderer": "external",       // "external" (Clippy window) | "ascii" (terminal widget)
    "shell": "auto",               // "auto" (Electron if installed) | "electron" | "browser" (Edge/Chrome app window)
    "autoOpen": true,              // open the Clippy window on session start
    "port": 8765,                  // localhost port for the viewer (stable so the window reconnects)
    "voice": false,                // speak balloons aloud (Electron shell)
    "voiceRate": 1,                // speech rate (0.5 - 2)
    "voicePitch": 1,               // speech pitch (0 - 2)
    "cameoChance": 0.2,            // how willing Clippy is to send for a rival (0 = he never does)
    "profanity": true,             // let Clippy swear on the rare lines where he is genuinely furious
    "crosstalkChance": 0.65,       // per-line chance an open buddy/Clippy replies to a line (0 = off)
    "cameos": ["bonzi","genie","merlin","rover","rocky","peedy","links"],
    "cameoHoldMs": 8000,           // how long a cameo window lingers when it dismisses itself
    "banterChance": 0.5,            // chance a cameo conjures a partner to argue with (0 = off)
    "annoyanceChance": 0.15,        // chance Clippy/a buddy tires of a repeat interrupter and turns it off (0 = off)
    "konami": true,                // ↑↑↓↓←→←→ B A summons Bonzi
    "dailyGreeting": true,         // first session of the day gets a stats greeting
    "greetingChance": 0.6,         // probability of that greeting
    "seasonal": true,              // seasonal + holiday-aware office offers (0 = off)
    "hemisphere": "north"          // "north" | "south" — which way the seasons run
  }
}
```

The provider and model must already be configured in pi.

Config changes — voice, cameos, shell, anything — are read when a session
starts, so after editing `settings.json` restart pi once. The already-open
Clippy window reloads itself with the new settings on the next open; if it was
closed, `/clippy-open` reopens it configured fresh.

## Character features

By default, **Clippy sounds like the real thing**: the cheerful, dim-witted paperclip from Office 97 who is sure everything you do is a letter or a spreadsheet. His personality moves with his mood — mostly delighted and eager to help, sometimes warmly kind, sometimes snippy when ignored, sometimes wonderfully stupid about what you are actually doing — but always simple, earnest, and small-voiced. The voice lives in his system prompt, so nothing is quota-driven: reading the evidence he simply forms the urge. When he does offer help, he writes the offer himself in his own words (`Would you like help with it?`), and the option buttons are his own short labels (validated: 2-3 labels, always including a refusal like `No` or `Not now`) — a question always comes with buttons to answer it.

He also **persists like the real paperclip**: say No and he re-asks the same offer a minute or two later, sullenly, escalating each time; refuse twice and a `Don't show this tip again` button appears that really silences that subject for the session; and leave one of his questions unanswered long enough and he will assume the answer was a yes. The nag is event-driven and session-scoped — it never outlives the session.

- **Rival assistants** — a rival (bonzi, genie, merlin, rover, rocky, peedy, links — clippyjs ships them all) never simply materializes: **every buddy window is somebody's doing.** Clippy sends for one when his line calls for it (his own in-character `summon`) or when the session is going badly enough that he would rather not be alone with it — and he says so out loud first, so the new window has a visible cause. Buddies also send for each other, and you can summon anyone from the right-click menu, the `Second opinion` button, or the konami code. `cameoChance` is how willing Clippy is to make that call (`0` = he never does, and only you open buddy windows). **Every opening line reacts to what Clippy just said**: the buddy HEARD his last line and answers with a pun about Clippy or paperclips, mockery, or advice (model-generated, in each buddy's own voice; the canned greeting is the fallback when the model is slow). Each cameo has **its own dialog box** and the **same right-click menu as Clippy**. `cameos` selects who can appear; `cameoHoldMs` controls how long a transient visit lasts; `banterChance` makes a cameo conjure a **partner to argue with** (a real back-and-forth between two windows). **Click a buddy and it talks to you**; summoned/clicked buddies stick around. **Crosstalk is systematic — and strictly one message at a time**: every open window hears every line — when Clippy speaks, every open buddy may answer; when a buddy speaks, Clippy and every other open buddy may answer. A shared floor voices the balloons one after another and only starts the next after the current one has been read (and voiced, when `voice` is on) and its window reports it is done, so a buddy's reply **never loads on top of — or right after —** Clippy's. Any pair can exchange a **bounded three-beat argument** (reply, then a counter-reply back) before the pair cools down for a while, so two windows can argue but never talk forever. Replies are **thread-aware** — the model sees the pair's recent exchange, not just the last line — and are **retried instead of silently dropped** when Clippy is mid-generation; when the model is stuck, every agent falls back to a canned retort in its own voice (previously only Clippy did). A buddy's line is never left hanging (Clippy answers even when everyone rolls past the chance), and when Clippy finally tires of a repeat interrupter and turns it off, he does it *after* the current exchange finishes, never mid-sentence — and you can always do it yourself from any window's *Turn off a buddy* menu. **Buddies remember each other for the session** (arguments and turn-offs color later lines, never persisted).
- **He reads the room** — a session climate (`src/mood.ts`) is derived from the same bounded evidence his lines are written from, and it sets his register instead of a dice roll: **proud** when a suite goes green, **concerned** when failures stack up, **snippy** when the *same* failure comes back a third time, **furious** when it has come back five or six (error signatures are normalized, so a repeat is detected even when only the line numbers moved), **worried** about *you* after ninety unbroken minutes, **bored** when nothing is happening. Every balloon is also handed one concrete fact — "the last test run failed", "the file viewer.ts was just updated" — so his lines land on something real instead of a vibe.
- **He has a temper, and it is rare** — the paperclip is relentlessly nice, so the one time he snaps has to be earned. It takes both halves of a bad day: a session that keeps breaking in the same place *and* a personal grievance (offers refused, tips silenced, questions ignored). Only then may he swear, and even then only about one furious line in four — a mild word normally, and the properly strong one only once he has really been ground down. `"profanity": false` keeps him permanently polite (`src/temper.ts`, `test/temper.test.ts`).
- **The buddies read the same room** — the climate goes into every buddy's prompt too, so an open buddy will speak up about *your* session unprompted: the build broke and the bird has a comment. Casting follows the moment (the dry voices turn up for a repeated failure, the enthusiasts for a success), and crosstalk volume scales with it — when things are going badly the buddies stop bickering with each other and stick to the event, and a dead-quiet room gets a little more chatter. Their **session memory now reaches the model**: a buddy Clippy switched off an hour ago comes back and *says so*, instead of only the canned lines remembering.
- **Seasons and holidays** — Clippy knows what time of year it is and what day it is (`src/seasons.ts`), and his office help bends to match: holiday cards in late December, receipts at tax time, a costume sign-up sheet at Halloween, a list of hiding places over Easter. Detected holidays include the fixed dates (New Year, Valentine's, St Patrick's, April Fools', Independence Day, Halloween, Christmas, New Year's Eve), the **computed** ones (Easter by the Gregorian computus, Thanksgiving and the Friday after, Mother's/Father's Day, Memorial and Labor Day), the incidental ones (leap day, **Friday the thirteenth**), and 16 January — the day Office 97 shipped, which the paperclip considers his birthday and will mention. The buddies are told about the holiday too. `seasonal: false` turns the whole layer off; `hemisphere: "south"` flips the seasons so a January session is not offered snowflake letterhead in Melbourne.
- **Voice** — `voice: true` makes balloons spoken aloud via the Electron renderer's speech synthesis (`voiceRate`, `voicePitch`).
- **Personal stats** — streaks, session count, balloon count, and today's test results persist in `~/.pi/agent/clippy-stats.json`. The daily greeting (first session of the day, `greetingChance`) says things like "It looks like you are on a 4-day streak. Would you like help writing a résumé?" and `/clippy stats` shows them on demand.
- **Easter eggs** — the konami code summons Bonzi (`konami`), and `/clippy party` plays an 8-second animation parade with a rival crashing the party. Ultra-rare, Clippy may greet a long stare with `CLIPPYLEAKMARKER.` — the one string that was never meant to be spoken.

## How the window works

The extension hosts a tiny HTTP server bound to `127.0.0.1` (token-protected; the token is persisted in `%TEMP%/pi-clippy` so the window can reconnect across pi restarts). It serves the Clippy page plus the clippyjs vendor modules (from `node_modules/clippyjs/dist`, with a jsDelivr fallback) and streams `state`/`balloon` events over Server-Sent Events.

Two shells:
- **Electron** (`shell/main.cjs`, default when installed): transparent + frameless + always-on-top, single-instance, no browser involved. Requires `electron` in `node_modules` (installed with `npm install`).
- **Browser app window** (fallback, or `"shell": "browser"`): Edge/Chrome `--app` mode with a dedicated profile, 280×340.

Clicks POST back to `/command`: clicking Clippy — or his dialog box — behaves like `/clippy`.

## Develop

```sh
npm install                 # dev dependencies (typecheck + tests)
npm test                    # typecheck, then the whole suite
npm run typecheck           # tsc only
npm run test:unit           # the suite only
```

Individual suites, when you want one:

```sh
npx tsx test/actions.test.ts # button effects: label to effect, the request an acceptance sends
npx tsx test/temper.test.ts # temper: when fury is earned, when (rarely) he swears
npx tsx test/viewer.test.ts # viewer server: routes, SSE, token auth, traversal guard, command fields
npx tsx test/runtime.test.ts # runtime → viewer event flow
npx tsx test/buddy.test.ts  # buddy system: summon/keep/close, session memory, turn-offs
npx tsx test/floor.test.ts  # one-message-at-a-time floor: serialization + balloon-gone release
npx tsx test/crosstalk.test.ts # messaging: mic-back, cooldown, guaranteed ack, turn-off timing
npx tsx test/nag.test.ts    # offer nag: escalation, snooze button, silence-as-yes
npx tsx test/mood.test.ts   # session climate: error signatures, mood ladder, mood-aware casting
npx tsx test/seasons.test.ts # calendar: seasons, fixed + computed holidays (checked against real dates)
npx tsx test/stats.test.ts  # personal stats: one test run counted once, streaks, the greeting
npx tsx test/dryrun.test.ts # environment probe: which shell would launch here (not in npm test)
```

### Debugging the window

The window's relayout loop is the one place bugs surface as frozen, drifting
windows. If you suspect a regression, run the probe rig:

```sh
npm run probe   # or: npx tsx scripts/repro-drift.ts
```

It opens a Clippy window plus a buddy, broadcasts a balloon with choices
mid-run, and prints a `PROBE` line twice a second: every window's bounds plus
a count of `setBounds` IPC calls since the last line. A healthy window
settles to `bounds=0` after each real layout change and holds its position; a
relayout feedback loop shows up as a sustained flood (tens of calls per line)
and a wandering position. `scripts/probe-main.cjs` is the instrumented shell
main that actually counts the calls and reads the page DOM.

Gotcha: clippyjs binds `window.resize` to its own reposition handler, which
writes the balloon's style. Never observe the balloon's `style` attribute
with a MutationObserver and relayout on it — that closes a resize →
reposition → relayout → setBounds → resize cycle that freezes the window and
walks it sideways. The client uses a ResizeObserver (fires only on real size
changes) plus a 1px idempotency guard on `setBounds`, and detaches the
library's resize handler. Keep those three properties intact in any future
window work. Note that unaddressed balloon broadcasts (`no to:` field) are
deliberate — buddies are meant to hear Clippy's lines and answer; `to:`
addresses a single window. All balloon delivery (Clippy's and every buddy's)
runs through a shared **floor** that voices exactly one message at a time:
the window holding the floor reports `balloon-gone` when its balloon closes
(or the user answers it) so the next message starts only after the previous
has been read and voiced, with a fallback reading timer as insurance against
a dead renderer. That is what keeps a buddy's reply from loading right after,
or on top of, Clippy's — and buddies talking to each other are serialized the
same way.

## License and credits

MIT. Port of [`dsh-clippy`](https://github.com/xlr8harder/dsh-clippy) (MIT), which uses the extracted Clippit animation table and sprite atlas from [`clippyjs`](https://github.com/pithings/clippy) / [`clippy.js`](https://github.com/clippyjs/clippy.js). Microsoft retains the character artwork, animations, sounds, names, and brand; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
