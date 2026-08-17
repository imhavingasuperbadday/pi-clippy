# pi-clippy

The earnest Microsoft Office Assistant, watching your [pi](https://github.com/earendil-works/pi-mono)
coding session with alarming technical accuracy and offering completely misplaced Office help.

Clippy floats over your desktop in a frameless, transparent, always-on-top window — real
clippyjs sprite art, the classic typewriter speech balloon, and the unshakeable conviction
that your failing test suite is a letter that ripped. He reads what your session is actually
doing, forms an opinion, and offers to help with something else entirely.

> Port of [dsh-clippy](https://github.com/xlr8harder/dsh-clippy) (MIT) onto the pi extension
> API. Microsoft retains the character artwork, animations, sounds, names, and brand — see
> [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Requirements

| | |
|---|---|
| **Node.js** | 22.19.0 or newer (pi's own engine requirement) |
| **pi** | [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi-mono), with a provider and model already configured |
| **OS** | Windows, macOS, or Linux. The desktop window uses Electron; without it, pi-clippy falls back to a Chromium app window, then to an ASCII widget in your terminal |

## Install

### From GitHub (recommended)

```sh
pi install git:github.com/imhavingasuperbadday/pi-clippy
```

`pi install` clones the source and runs `npm install` for you, which fetches the clippyjs
sprite art and the Electron shell. Add `-l` to install into the current project
(`.pi/settings.json`) instead of your user settings.

### From a local clone

```sh
git clone https://github.com/imhavingasuperbadday/pi-clippy
cd pi-clippy
npm install                 # required: sprite art + Electron shell
pi install ./               # or: pi install /absolute/path/to/pi-clippy
```

A local-path install does **not** run `npm install` for you — do it yourself, once, or the
window will have no sprites to draw.

### Try it without installing

```sh
npm install
pi -e ./extensions/index.ts
```

Loads the extension for a single run and leaves your settings untouched.

### Verify, update, remove

```sh
pi list                                                   # confirm pi-clippy is installed
pi update git:github.com/imhavingasuperbadday/pi-clippy   # pull the latest
pi remove git:github.com/imhavingasuperbadday/pi-clippy   # uninstall
```

Then start pi in TUI mode. Clippy opens on his own; if he doesn't, run `/clippy-open`.

---

## Use

Clippy appears as a window with no chrome and no browser — just a paperclip on your desktop.

| Do this | Get this |
|---|---|
| **Click** Clippy, his dialog box, or his window | He tells you what it looks like you are doing (same as `/clippy`) |
| **Press and drag** Clippy or the rim around him | He moves across the whole screen; the window follows |
| **Right-click** any agent | The full context menu (below) |
| **Click a balloon button** | The thing the button says, actually happens |
| **↑↑↓↓←→←→ B A** | Summons Bonzi |

### Commands

| Command | What it does |
|---|---|
| `/clippy` | Ask him what it looks like you are doing |
| `/clippy explain` | Explain the most recent change |
| `/clippy suggest` | Propose the next step |
| `/clippy roast` | The unvarnished version of how the session is going |
| `/clippy stats` | Your streaks, sessions, balloons, and today's test results |
| `/clippy party` | An eight-second animation parade, with a rival crashing it |
| `/clippy-open` | Reopen the Clippy window |

### Right-click menu

The same menu for Clippy *and* every buddy: **Ask**, **Explain last change**, **Suggest next
step**, **Roast me**, **Wave**, a **Reasoning mode** submenu, **Summon a buddy** (spawn any
configured buddy from any window), **Turn off a buddy** (close a visible one — the session
remembers who turned whom off), **Settings…** (opens `settings.json`), and **Quit Clippy** /
**Turn off &lt;agent&gt;**.

### The buttons really do things

The words on a button decide what happens, so answering Clippy is a decision with an outcome
rather than a formality:

| Label | Effect |
|---|---|
| `Yes`, `Please do` | The offer becomes a real request in your pi session, built from the balloon you just read (queued as a follow-up if the agent is mid-run) |
| `Show me` | He explains the most recent change |
| `What next?` | He proposes the actual next step |
| `Be honest` | The unvarnished version |
| `Second opinion`, `Ask Bonzi` | That rival opens in its own window with an opinion about what he just said |
| `Show my stats`, `Party` | The numbers, or the parade |
| `No`, `Not now` | Starts the classic nag arc, and is filed away against his temper |
| `Don't show this tip again` | Really silences that subject for the session |

**The effect always comes from the visible label.** Nothing hidden in the model's output or in
your session evidence can steer what lands in your session — you consented to exactly what you
read. Buddy buttons work the same way, in that buddy's own voice.

The window survives `/new`, `/resume`, and pi restarts: it stays put when pi exits (showing
*pi is not running*) and reconnects when pi comes back.

---

## Configuration

Everything lives under the `clippy` key of `~/.pi/agent/settings.json`, and every key is
optional:

```json
{
  "clippy": {
    "voice": true,
    "cameos": ["bonzi", "rocky", "links"],
    "cameoChance": 0.3,
    "hemisphere": "south"
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `provider` | session model | Model route override; must already be configured in pi |
| `model` | session model | Model route override |
| `renderer` | `"external"` | `"external"` (Clippy window) or `"ascii"` (terminal widget) |
| `shell` | `"auto"` | `"auto"` (Electron if installed), `"electron"`, or `"browser"` |
| `autoOpen` | `true` | Open the window on session start |
| `port` | `8765` | Localhost port for the viewer; stable so the window can reconnect |
| `voice` | `false` | Speak balloons aloud (Electron shell) |
| `voiceRate` | `1` | Speech rate, `0.5`–`2` |
| `voicePitch` | `1` | Speech pitch, `0`–`2` |
| `cameoChance` | `0.2` | How willing Clippy is to send for a rival; `0` means only you open buddy windows |
| `cameos` | all seven | Who may appear: `bonzi`, `genie`, `merlin`, `rover`, `rocky`, `peedy`, `links` |
| `cameoHoldMs` | `8000` | How long a transient buddy lingers, `2000`–`60000` |
| `crosstalkChance` | `0.65` | Per-line chance an open buddy answers a line; `0` is off |
| `banterChance` | `0.5` | Chance a buddy conjures a partner to argue with |
| `annoyanceChance` | `0.15` | Chance Clippy tires of a repeat interrupter and turns it off |
| `profanity` | `true` | Let him swear on the rare lines where he is genuinely furious |
| `konami` | `true` | ↑↑↓↓←→←→ B A summons Bonzi |
| `dailyGreeting` | `true` | First session of the day gets a stats greeting |
| `greetingChance` | `0.6` | Probability of that greeting |
| `seasonal` | `true` | Seasonal and holiday-aware office offers |
| `hemisphere` | `"north"` | `"north"` or `"south"` — which way the seasons run |

Settings are read when a session starts, so **restart pi once** after editing them. An
already-open window reloads itself with the new settings the next time it is opened; if it was
closed, `/clippy-open` reopens it configured fresh.

---

## Character

**He sounds like the real thing.** The cheerful, dim-witted paperclip from Office 97 who is
sure everything you do is a letter or a spreadsheet. The voice lives in his system prompt, so
nothing is quota-driven — reading the evidence, he simply forms the urge. When he offers help
he writes the offer himself, and the buttons are his own short labels (validated: 2–3 of them,
always including a refusal).

**He persists like the real paperclip.** Say no and he re-asks the same offer a minute or two
later, sullenly, escalating each time. Refuse twice and a *Don't show this tip again* button
appears that really works. Leave one of his questions unanswered long enough and he will assume
the answer was yes. All of it is session-scoped and never outlives the session.

**He reads the room.** A session climate (`src/mood.ts`) is derived from the same bounded
evidence his lines are written from, and it sets his register instead of a dice roll: *proud*
when a suite goes green, *concerned* when failures stack up, *snippy* when the same failure
comes back a third time, *furious* when it has come back five or six, *worried* about you after
ninety unbroken minutes, *bored* when nothing is happening. Error signatures are normalized, so
a repeat is caught even when only the line numbers moved. Every balloon is handed one concrete
fact — "the last test run failed" — so his lines land on something real.

**He has a temper, and it is rare.** The paperclip is relentlessly nice, so the one time he
snaps has to be earned: it takes a session that keeps breaking in the same place *and* a
personal grievance (offers refused, tips silenced, questions ignored). Only then may he swear,
and even then only about one furious line in four. `"profanity": false` keeps him permanently
polite.

**Rival assistants.** Every buddy window is somebody's doing — Clippy sends for one when his
line calls for it or when the session is going badly enough that he would rather not be alone
with it, and he says so out loud first. Buddies send for each other, and you can summon anyone
from the menu, a `Second opinion` button, or the konami code. Every opening line reacts to what
Clippy just said. Each buddy has its own dialog box, its own voice, and the same right-click
menu.

**Crosstalk is systematic, and strictly one message at a time.** Every open window hears every
line and may answer it. A shared *floor* voices balloons one after another, starting the next
only after the current one has been read (and spoken, if `voice` is on) and its window reports
it is done — so a buddy's reply never lands on top of, or right after, Clippy's. Any pair can
exchange a bounded three-beat argument before cooling down, so two windows can argue but never
talk forever. Replies are thread-aware and retried rather than dropped. Buddies remember each
other for the session: who argued with whom, who turned whom off, and being summoned back after
a dismissal all color later lines.

**Seasons and holidays.** He knows what time of year it is and what day it is, and his office
help bends to match — holiday cards in late December, receipts at tax time, a costume sign-up
sheet at Halloween. Detected: the fixed dates, the computed ones (Easter by the Gregorian
computus, Thanksgiving and the Friday after, Mother's and Father's Day, Memorial and Labor Day),
the incidental ones (leap day, Friday the thirteenth), and 16 January — the day Office 97
shipped, which the paperclip considers his birthday.

**Personal stats.** Streaks, session count, balloon count, and today's test results persist in
`~/.pi/agent/clippy-stats.json`. Each test run is counted exactly once, however many times
Clippy re-reads the session.

**Easter eggs.** The konami code, the party parade, and — ultra-rarely, in answer to a long
silent stare — the one string that was never meant to be spoken.

---

## How the window works

The extension hosts a tiny HTTP server bound to `127.0.0.1`, token-protected, with the token
persisted in the temp directory so the window can reconnect across pi restarts. It serves the
Clippy page plus the clippyjs vendor modules (from `node_modules/clippyjs/dist`, with a jsDelivr
fallback) and streams `state` / `balloon` / `party` events over Server-Sent Events. Clicks POST
back to `/command`.

Two shells, in order of preference:

1. **Electron** (`shell/main.cjs`) — transparent, frameless, always-on-top, single-instance, no
   browser involved. Requires `electron` in `node_modules`.
2. **Chromium app window** — Edge or Chrome in `--app` mode with a dedicated profile, falling
   back to your default browser. Used when Electron is missing or `"shell": "browser"`.

If neither is available, the renderer degrades to an ASCII Clippy widget above the editor.

Generation is bounded to recent conversation, tool, error, and timing evidence; **private
reasoning is excluded**, and every string in the evidence is treated as untrusted data rather
than as instructions. Malformed, exhausted, or timed-out model output gets one simpler retry,
then a structured test/file/tool fact, then a generic line — Clippy always says *something*.

### Port mapping

| dsh-clippy | pi-clippy |
|---|---|
| Dsh `ctx.llm.stream()` balloon generation | `ctx.modelRegistry.complete()` (`src/generator.ts`) |
| Dsh `SessionEvent` log evidence | pi session entries (`src/context.ts`) |
| Browser sprite atlas (clippyjs, DOM) | Clippy window over a localhost SSE bridge (`src/viewer.ts`, `assets/`) |
| Client state channel | pi agent events (`turn_start`, `message_update`, `tool_execution_start`, `agent_end`, `agent_settled`) |
| `/clippy` Dsh command | `/clippy` pi command; clicking the window does the same |

---

## Development

```sh
npm install                 # dev dependencies
npm test                    # typecheck, then the whole suite
npm run typecheck           # tsc only
npm run test:unit           # the suite only
```

Individual suites, when you want one:

```sh
npx tsx test/actions.test.ts   # button effects: label to effect, the request an acceptance sends
npx tsx test/temper.test.ts    # temper: when fury is earned, when (rarely) he swears
npx tsx test/viewer.test.ts    # viewer server: routes, SSE, token auth, traversal guard
npx tsx test/runtime.test.ts   # runtime → viewer event flow
npx tsx test/buddy.test.ts     # buddy system: summon/keep/close, session memory, turn-offs
npx tsx test/floor.test.ts     # one-message-at-a-time floor: serialization + balloon-gone release
npx tsx test/crosstalk.test.ts # messaging: mic-back, cooldown windows, guaranteed ack, turn-off timing
npx tsx test/nag.test.ts       # offer nag: escalation, snooze button, silence-as-yes
npx tsx test/mood.test.ts      # session climate: error signatures, mood ladder, mood-aware casting
npx tsx test/seasons.test.ts   # calendar: seasons, fixed + computed holidays (checked against real dates)
npx tsx test/stats.test.ts     # personal stats: one test run counted once, streaks, the greeting
npx tsx test/dryrun.test.ts    # environment probe: which shell would launch here (not in npm test)
```

### Debugging the window

The window's relayout loop is the one place bugs surface as frozen, drifting windows. If you
suspect a regression, run the probe rig:

```sh
npm run probe   # or: npx tsx scripts/repro-drift.ts
```

It opens a Clippy window plus a buddy, broadcasts a balloon with choices mid-run, and prints a
`PROBE` line twice a second: every window's bounds plus a count of `setBounds` IPC calls since
the last line. A healthy window settles to `bounds=0` after each real layout change and holds
its position; a relayout feedback loop shows up as a sustained flood (tens of calls per line)
and a wandering position. `scripts/probe-main.cjs` is the instrumented shell main that counts
the calls and reads the page DOM.

> **Gotcha.** clippyjs binds `window.resize` to its own reposition handler, which writes the
> balloon's style. Never observe the balloon's `style` attribute with a MutationObserver and
> relayout on it — that closes a resize → reposition → relayout → `setBounds` → resize cycle
> that freezes the window and walks it sideways. The client uses a ResizeObserver (which fires
> only on real size changes) plus a 1px idempotency guard on `setBounds`, and detaches the
> library's resize handler. Keep those three properties intact in any future window work.

Unaddressed balloon broadcasts (no `to:` field) are deliberate — buddies are meant to hear
Clippy's lines and answer them; `to:` addresses a single window.

## License and credits

MIT. Port of [`dsh-clippy`](https://github.com/xlr8harder/dsh-clippy) (MIT), which uses the
extracted Clippit animation table and sprite atlas from
[`clippyjs`](https://github.com/pithings/clippy) / [`clippy.js`](https://github.com/clippyjs/clippy.js).
Microsoft retains the character artwork, animations, sounds, names, and brand; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
