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
| **Three unhurried clicks** | You have petted the paperclip. There is a counter |
| **Two very fast clicks** | He jumps, and is annoyed about it exactly once |
| **Click a sleeping Clippy** | He wakes with a start and claims he was resting his eyes |
| **Drag him into a screen corner** | He mentions it next time he speaks |
| **Ten keys in a second** | "It looks like you are typing." |
| **Ctrl+L** | The classic line, on demand |
| **↑↑↓↓←→←→ B A** | Summons Bonzi |

### Commands

| Command | What it does |
|---|---|
| `/clippy` | Ask him what it looks like you are doing |
| `/clippy <message>` | Say something directly to Clippy; open buddies hear his reply and may join in |
| `/clippy explain` | Explain the most recent change |
| `/clippy suggest` | Propose the next step |
| `/clippy roast` | The unvarnished version of how the session is going |
| `/clippy stats` | Your streak, current rank, sessions, balloons, and today's test results |
| `/clippy party` | An eight-second animation parade, with a rival crashing it |
| `/clippy memo` | The day's work as an interoffice memo: lines → pages, commits → memos filed, pass rate → spell-check grade, session time → hours billed |
| `/clippy report` | The Annual Paperclip Report — the year from the stats file, as a performance review written by your paperclip |
| `/clippy commit` | He drafts your commit message in memo style (`Re: Additional speling corrections`) and hands you the text to paste |
| `/clippy duck` | Rubber-duck mode: he listens, asks one clarifying question per message, and offers nothing. Toggle |
| `/clippy meeting` | Convene the board: every open assistant proposes one next step, then Clippy delivers the committee's recommendation |
| `/clippy play` | Rock, paper, scissors, best of three, played entirely through balloon buttons |
| `/clippy duel` | The scripted Merlin duel: he conjures, Clippy clips |
| `/clippy shush` | Silence him (same as the menu item) |
| `/clippy secrets` | Open **THE SECRETS OF CLIPPY** — see **Easter eggs** below |
| `/clippy destiny` | What he is working on in the background, and what he has changed — see **Clippy's life's work** below |
| `/clippy destiny <goal>` | Give him a long-running goal of his own, and the list of files he may touch |
| `/clippy destiny grant` | Let him work on it during this session (asks first, and names every limit) |
| `/clippy destiny log` | Every file he has changed for the goal, with what he says he did |
| `/clippy destiny stop` / `forget` / `done` | Take the permission back, retire the goal, or declare it finished |
| `/clippy-open` | Reopen the Clippy window |
| `/clippy-settings` | Configure him for future sessions, with a guided editor — see **Configuration** |

Typing one of the magic words as a message works too — see **Easter eggs** below.

### Right-click menu

The same menu for Clippy *and* every buddy: **Ask**, **Explain last change**, **Suggest next
step**, **Roast me**, **Wave**, **Shut up** (below), **Feed Clippy**, a **Reasoning mode**
submenu, **Hold a board meeting**, **Summon a buddy** (spawn any configured buddy from any
window), **Turn off a buddy** (close a visible one — the session remembers who turned whom
off), **Settings…** (opens `settings.json`), and **Quit Clippy** / **Turn off &lt;agent&gt;**.

**Shut up** silences that one agent completely: no idle thoughts, no input comments, no nag
re-asks (their timers pause rather than reset, so the arc resumes where it left off), no cameo
announcements, no crosstalk replies or acknowledgments, no greeting, and any speech in flight
stops. He stays visible and draggable, with a strip of tape across his mouth so you can see at
a glance that he is muted. The item flips in place to **Let me talk again** with a tick beside
it. Explicit asks still get a (sullen) answer, because you started those — a paperclip that
ignores a direct question reads as broken rather than obedient.

Silence has a cost. While muted he keeps a short list of what you missed, and unmuting spends
exactly one line on it: *"I can talk again? You missed a green test run AND my reaction to
it."* Being told to shut up also counts as a personal grievance in the temper ladder, and the
lifetime count lands in the stats file. Muting Clippy does not mute the buddies; each window
has its own toggle. Typing "shut up" at him does the same thing for sixty seconds.

Turning Clippy off also goes quiet on the appearances: while he is muted no buddy window opens
on its own — no idle summons, no "send for help", no rival dragged in by a balloon — so the
desktop stops volunteering company until you ask for it. Buddies already out stay out (still
talkative, still individually muted), and turning a buddy off keeps it gone until you summon it
by name; only explicit calls open windows.

### The buttons really do things

The words on a button decide what happens, so answering Clippy is a decision with an outcome
rather than a formality:

| Label | Effect |
|---|---|
| `Send it to pi` | Clippy drafted real work for the coding agent and **printed it in the balloon**; pressing this sends that exact text into your session as your own message (queued as a follow-up if the agent is mid-run) |
| `Yes`, `Please do` | Clippy carries the offer out himself: he reads the project files and, when it genuinely helps, makes one small careful edit — inside the project only, never commands or tests — then reports what he actually did. A buddy's yes can't touch files, so it asks your pi session for real instead |
| `Show me` | He reads the files first, then explains the most recent change |
| `What next?` | He reads the files first, then proposes the actual next step — and ends with a `Send it to pi` button, so the step is one click from being taken |
| `Be honest` | The unvarnished version |
| `Second opinion`, `Ask Bonzi` | A rival opens in its own window and owes you an actual opinion — one concrete take on the work (the file, the test, the step), in its own voice. Casting rotates, so it is a different rival than last time |
| `Show my stats`, `Party` | The numbers, or the parade |
| `No`, `Not now` | Starts the classic nag arc, and is filed away against his temper |
| `Don't show this tip again` | Really silences that subject for the session |

#### Handing the job to pi

Clippy sees your work through Office eyes, but he knows there is a real coding agent in the
room. When his offer maps to actual work — the failing test, the half-written function, the
error he keeps seeing go past — he writes the job down as one plain instruction and **shows it
to you inside the balloon**:

> *It looks like a letter has ripped down one side. I have written it out for the big model:*
> *"Fix the failing assertion in test/floor.test.ts — the ResizeObserver stub never fires."*
> `Send it to pi`  `Not now`

Pressing `Send it to pi` puts that text, character for character, into your session as your own
message, and the agent picks it up. Nothing is appended, nothing is rewritten between reading
and sending, a balloon carrying a request is never given a planted typo, and silence is never
taken as a yes for one of these — he will decide plenty of things for you, but not this. If
there is no drafted request, a yes is Clippy's own job and nothing goes into your session at
all.

**The effect always comes from the visible label, and the label also decides which of Clippy's
file powers the model may use.** Nothing hidden in the model's output or in your session
evidence can steer what lands in your session — you consented to exactly what you read, which
is why the request is quoted in front of the button rather than hidden behind it. Only a plain
yes grants edit powers; "Show me" and "What next?" grant reads; every other button grants no
file access at all. Buddy buttons work the same way, in that buddy's own voice — and buddies
start with no file access whatsoever.

The window survives `/new`, `/resume`, and pi restarts: it stays put when pi exits (showing
*pi is not running*) and reconnects when pi comes back.

---

## Working with pi

Most of this extension watches pi. Three parts of it work *with* pi.

### Clippy's desk notes

Clippy keeps a running memo of the session — the thing you said at the start when you explained
what you were doing, the error that has now come up four times, the file you have opened eleven
times, whether the tests last passed — and hands a short block of it to the coding agent before
every model call. It is the context a long session loses first, and Clippy was sitting there
watching it happen anyway.

The block is **reference data, never instructions.** It says so in its own header, every string
in it is flattened to one line and length-capped, and it is placed *before* your latest message
so your request is still the last word. Nothing in it can be an instruction, because nothing
that goes into it survives contact with `sanitizeFact` in a shape that could be one.

Turn it off with `"deskNotes": false`.

### The coding agent can call him

Two real pi tools, registered for the agent running your session:

- **`ask_clippy`** — the agent stops mid-turn and asks his opinion. He reads the project (read
  only, always) and answers in character, and the answer appears in his window too, so you can
  watch the consultation happen. He is advisory: he cannot edit, run, or send anything.
- **`clippy_remember`** — the agent files one short fact with him ("no new dependencies"), and
  that fact rides along in the desk notes for the rest of the session.

Turn both off with `"agentTools": false`.

### Clippy's life's work

Give him a long-running goal and he will work on it quietly while you are doing something else.

```
/clippy destiny keep the README install steps matching the actual flags
```

He then asks which files he may edit, and asks again — in a dialog naming the goal, the exact
list of files, and the edit cap — before he touches anything.

**Every limit is real and none of them are in a prompt:**

| Limit | Enforced by |
|---|---|
| The goal and the file list come from you | Nothing the model writes can set, widen, or reword either |
| Edits are confined to that file list | `src/files.ts`, the same choke point every file operation goes through |
| At most four small edits per session | `src/destiny.ts`, session-scoped and never persisted |
| Only while pi is genuinely idle | Aborted the instant you start a turn |
| Everything is logged | `/clippy destiny log`, and `git diff` undoes the lot |

The permission is **per session**. Tomorrow he asks again. `/clippy destiny stop` takes it back
immediately; `/clippy destiny forget` retires the goal entirely.

He is also honest about it with the coding agent: while a goal is active, the desk notes say so,
so the agent is not surprised to find a paperclip's fingerprints in the working tree.

The pi status line shows what he is up to (`clippy destiny: 2/4 edits this session`), and the
window shows the same thing as a small chip in the corner of the sprite.

What you will actually get is a paperclip who fixes the comment typo before he fixes the code,
and who is very proud of it.

Turn the whole system off with `"destiny": false`.

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
    "idleThinking": true,
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
| `idleThinking` | `true` | Clippy thinks in the background while the session is idle and, when he feels like it, acts on the thought |
| `idleThinkAfterMs` | `120000` | How long the session must be quiet before his first background thought |
| `idleThinkCooldownMs` | `300000` | Minimum quiet time between one background thought and the next |
| `inputCommentChance` | `0.35` | Per-message chance Clippy reads what you type before it is sent and says one short thing about it; `0` is off — the send is never blocked or rewritten |
| `cameos` | all seven | Who may appear: `bonzi`, `genie`, `merlin`, `rover`, `rocky`, `peedy`, `links` |
| `cameoHoldMs` | `8000` | How long a transient buddy lingers, `2000`–`60000` |
| `crosstalkChance` | `0.65` | Per-line chance an open buddy answers a line; `0` is off |
| `banterChance` | `0.5` | Chance a buddy conjures a partner to argue with |
| `annoyanceChance` | `0.15` | Chance Clippy tires of a repeat interrupter and turns it off |
| `profanity` | `true` | Let him swear on the rare lines where he is genuinely furious |
| `rapport` | `true` | Let the yeses, pets, snubs and shushes build a relationship that sets his register and carries across days; `false` makes him the same cheerful stranger every session |
| `konami` | `true` | ↑↑↓↓←→←→ B A summons Bonzi |
| `dailyGreeting` | `true` | First session of the day gets a stats greeting |
| `greetingChance` | `0.6` | Probability of that greeting |
| `seasonal` | `true` | Seasonal and holiday-aware office offers |
| `hemisphere` | `"north"` | `"north"` or `"south"` — which way the seasons run |
| `deskNotes` | `true` | Give the coding agent Clippy's running desk notes before each model call |
| `agentTools` | `true` | Register `ask_clippy` and `clippy_remember` so the coding agent can consult him |
| `destiny` | `true` | Allow the background-goal system; each session still needs an explicit grant |

### `/clippy-settings`

You do not have to edit that file by hand. `/clippy-settings` opens a guided editor: fields
grouped by what they affect, the current value next to each one, one line explaining what it
actually does, and bounds checking on the way in (`90s` and `5m` are both understood where a
duration is wanted; `35` and `35%` and `0.35` all mean the same thing where a chance is). It
writes only the `clippy` key and leaves the rest of your `settings.json` exactly as it was.

Two shorter forms for when you already know what you want:

```
/clippy-settings show          # print everything as it currently stands
/clippy-settings voice yes     # set one key and save
/clippy-settings cameoChance unset   # go back to the default
```

Settings are read when a session starts, so **restart pi once** (or `/reload`) after editing
them — Clippy does not re-read them mid-session, and the editor says so when it saves. An
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
appears that really works. Leave one of his questions unanswered long enough and he resolves it
himself, one of three ways: he assumes the answer was yes and actually carries the offer out
(the same file powers a pressed Yes gets), he gets annoyed and decides against it, or he simply
lets it go without a word — the desktop stays free instead of sitting on a stale decision. All of
it is session-scoped and never outlives the session.

**He thinks in the background.** When you are doing nothing — no turn running,
no new content — Clippy quietly thinks to himself in the thinking pose. A
background thought is private: the model decides what he *feels like doing*
(*start a chat with a buddy*, *offer help*, *say one small thing*, or *do
nothing*), and only what he decides to do reaches the desktop. If he wants
company he says so out loud and sends for a rival, whose arrival reacts to
his exact words, and the existing crosstalk machinery carries the
conversation on from there. A thought never edits files — an edit still
needs a pressed Yes — and the moment you come back with work, a half-formed
thought is abandoned. Chat impulses respect `cameoChance` (`0` = he never
calls anyone, even when he wants to).

**He reads the room.** A session climate (`src/mood.ts`) is derived from the same bounded
evidence his lines are written from, and it sets his register instead of a dice roll: *proud*
when a suite goes green, *concerned* when failures stack up, *snippy* when the same failure
comes back a third time, *furious* when it has come back five or six, *worried* about you after
ninety unbroken minutes, *bored* when nothing is happening. Error signatures are normalized, so
a repeat is caught even when only the line numbers moved. Every balloon is handed one concrete
fact — "the last test run failed" — so his lines land on something real.

The room has a **volume** and a **direction** as well as a name. Two failures and nine failures
are both *concerned*, but the second is felt at full strength, and the balloon's mood ring gets
visibly heavier and picks up a halo to match; a faint mood is told to understate itself instead.
Separately, the climate knows which way things are going — the failure rate over the last few
steps against the stretch before it — so he can say a session is *turning around* rather than
only that it is bad. The way a line comes in and the way it signs off follow the same register:
a furious line opens with "Right." or "Enough.", a proud one with "Would you look at that,", a
bored one trails off with "I have counted the paperclips. There are still that many."

**He remembers how you treat him.** Until now everything the paperclip felt about you was
negative: refusals, snoozes and shushes counted, and nothing else did. There is now one signed
relationship score (`src/rapport.ts`) that counts both directions — every accepted offer, every
request you let him hand to pi, every pet, every feed, every game played to the end, every page
of his book you read, against every no, snooze, shush and brush-off. It sets his **register**,
not his mood: on cool terms he is short, formal and volunteers noticeably less; on good terms he
is warmer, more confident, and occasionally says something about the two of you; at the top of
the scale he talks like a colleague rather than an assistant ("we", "our report"). How long you
have known each other is tracked separately, from sessions and your best streak, so an old
friend can be having a terrible day and a stranger a lovely one — and he will never allude to a
history you do not have.

The score **survives the session**: it is folded in once when the session ends and fades toward
neutral each new day, so a good run has to be kept up and a bad afternoon is not held against
you for a fortnight. Opening pi three times in one afternoon does not erase how the morning
went. The rivals are told where the two of you stand too, and will absolutely comment on it. A
lobotomy wipes the session's feelings — and records the wipe as something that happened to him.
`"rapport": false` turns the whole thing off.

**He has file powers, and only file powers.** Clippy may read your project's files on his own,
any time — his balloons, explanations, and suggestions can consult the real files first. Reading
is confined to the project directory, capped in size, text-only, and refuses obvious secrets
(`.env`, keys, credentials). Editing happens on exactly one occasion: when you press a yes
button, the model gets `edit_file` alongside `read_file`, may change at most two files with
small exact-match edits, and must report what it actually did. There is no shell, no command
execution, and no other tool — reads and edits are the whole toolbox (`src/files.ts`).

**Buddies have no file access unless Clippy grants it.** A buddy that wants to read the project
has to convince Clippy, in conversation, that it should be allowed — Clippy's prompts make him
stingy, a request must come before any grant, each buddy gets at most one grant, and a session
allows only a couple in total. A granted buddy may use its read access only for real-work
buttons ("Show me", "What next?"); it can never edit.

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

Two things keep the desktop from turning into the same rival on a loop. **Casting rotates**: one
shared rotation memory covers every summon (Clippy sending for help, a second opinion, a party
guest), and the last few faces are held back from the next draw, so the roster actually gets
used instead of the affinity table picking one favorite all session. And **a window that dies
without saying so is noticed**: every open buddy reports in on a heartbeat, and one that stops
is forgotten — without that, a shell that was killed or slept left its agent permanently
"on screen", which quietly made it unsummonable, made casting skip it as already present, and
stalled the message floor every time somebody addressed it.

**Every rival is an expert in exactly one thing.** Rocky judges test suites, Merlin considers
compilation an act of high sorcery, Rover fetches files, Links arbitrates tidiness, Peedy
announces anything that ships, Genie regards dependencies as wishes spent, and Bonzi would love
to write a very long formal document about your mistakes. The specialty rides in each buddy's
prompt, and it also decides **who turns up**: casting reads what actually just happened — a
failing suite, a broken build, a saved file, a push — and gives that moment's expert a better
shot at the summons, on top of the existing mood affinity and rotation. Being the authority on
today's disaster improves your odds; it never makes you the only assistant on the desktop.

**A second opinion is an opinion.** When you press the button, the rival that turns up has to
say something real about the actual work — the file, the test, the step it would take, or what
Clippy has got wrong — in its own voice. A joke with no opinion inside it is not a second
opinion.

**Crosstalk is systematic, and strictly one message at a time.** Every open window hears every
line and may answer it. A shared *floor* voices balloons one after another, starting the next
only after the current one has been read (and spoken, if `voice` is on) and its window reports
it is done — so a buddy's reply never lands on top of, or right after, Clippy's. Reply slots are
shuffled among the open listeners, so no pair monopolizes the mic. Any pair can exchange a
bounded three-beat argument before cooling down, so two windows can argue but never talk
forever. Replies are thread-aware and retried rather than dropped, and a buddy's line is never
left hanging: Clippy acknowledges it when everyone else rolled past the chance, retiring his
ack when a real reply landed first. Buddies remember each other for the session: who argued
with whom, who turned whom off, and being summoned back after a dismissal all color later
lines.

**Seasons and holidays.** He knows what time of year it is and what day it is, and his office
help bends to match — holiday cards in late December, receipts at tax time, a costume sign-up
sheet at Halloween. Detected: the fixed dates, the computed ones (Easter by the Gregorian
computus, Thanksgiving and the Friday after, Mother's and Father's Day, Memorial and Labor Day),
the incidental ones (leap day, Friday the thirteenth), and 16 January — the day Office 97
shipped, which the paperclip considers his birthday.

**Personal stats.** Streaks, session count, balloon count, and today's test results persist in
`~/.pi/agent/clippy-stats.json`. Each test run is counted exactly once, however many times
Clippy re-reads the session.

**Streaks are a whole bit, not just a number.** A streak climbs a mock corporate ladder
(Temp → Associate Paperclip → ... → Chairman of the Board (Paperclip Division) at a year),
shown in `/clippy stats`. Hit a milestone (3, 7, 14, 30, 50, 100, 200, or 365 days) and the
next day's greeting throws the real party animation instead of quietly incrementing a number.
Every 40 balloons banks one grace token (max 2) — quiet streak insurance that covers exactly one
missed day automatically, with a grudging line about it; without a token, a broken streak gets
its own somber acknowledgment naming the exact number lost, instead of resetting in silence. A
summoned rival buddy has a small, streak-length-gated chance of opening by needling you about it
instead of the usual greeting.

**He is finally right, once.** He has told everyone they were writing a letter since 1997 and
has been wrong every single time. When your project actually contains Office work — `resume.md`,
`budget.csv`, a `.docx`, an invoice — he notices, and he is not smug about it. Detection is pure
file-name logic, so the line lands the instant the file does, and the stats file remembers: once
per file kind, forever. A payoff you can farm is not a payoff.

**He plants typos.** About one balloon in twenty-five ships with a single deliberate
misspelling ("teh", "yuo", "lettre"). Call it out — say "typo", or just quote the word back —
and he is mortified, corrects himself, and the catch joins a lifetime counter. Only the
displayed text is ever altered: the nag, the permission scanner, and crosstalk all keep the line
he meant to say, so a misspelling can never change what a button does.

**He goes on strike.** Brush him off with *Not now* three times in a row — typed or pressed —
and the paperclip withdraws his labour: a tiny UNFAIR picket sign appears and he refuses to
volunteer anything for five minutes. He still answers you when you ask him something directly.

**Physical presence, with the window bolted down.** He falls asleep after a long quiet stretch
(eyes shut, a floating *z*; clicking wakes him with a start), paces back and forth while a
command runs past ten seconds, leans a few degrees toward your mouse pointer while idle, jumps
when startled (indignant the first time, weary the second, permanently braced thereafter),
strikes a content pose when petted, and sulks about being left in a corner.
**Every one of these moves the sprite, never the window.** Window movement is this renderer's
one known failure mode (see the relayout idempotency guard in `assets/client.js`), so the whole
physical layer is built to be structurally incapable of feeding it: no antic calls `setBounds`
or `setPosition`.

**Hats.** A party hat at streak milestones and on your install anniversary, a Santa hat through
December, a witch hat in late October, a top hat at the turn of the year, and a small crown once
your streak makes you management. CSS overlay on the sprite — no new art.

**The mood ring.** The balloon's border colour follows the session climate the extension already
computes every beat: green when he is proud, red when furious, grey when bored. The mood was
always there; now you can see it.

**He remembers how you left.** The final mood of a session and whether it ended on an unresolved
error are the only session state that outlives the session, and the next day's greeting
spends one line on it: *"you vanished last time with something still broken, you know."* On the
anniversary of your first session he says exactly how long you two have known each other. The
daily greeting also carries an office horoscope, seeded on the date.

**Boredom has something to do.** When the room goes genuinely dead he sometimes offers rock,
paper, scissors instead of another musing — best of three, played through the balloon buttons
that already exist. He believes in paper, which is why he loses.

Boredom also deepens with time, the way it does for a paperclip with no letters: past a few
quiet minutes he starts visibly entertaining himself (fidgety idle motions, an occasional
Searching glance around the room, one line about having counted the pixels twice), and past a
long dead stretch he admits to playing rock, paper, scissors against himself — and pushes the
game offer more eagerly the longer the room stays quiet. Each escalation is said exactly once,
so a dead session gets two small lines, not a running commentary, and the clock resets the
moment anything happens.

**Rubber-duck mode.** `/clippy duck` and he agrees to just listen: one clarifying question per
message, never a suggestion, no Office metaphors, no offers — and on the rare occasion one slips
out anyway, he apologizes for it. The one feature here with real productivity value.

**The board meeting.** `/clippy meeting` convenes every assistant on the desktop into a
structured deliberation: each proposes one concrete next step in character, the shared floor
turns that into an agenda that reads in order, and Clippy closes as chair with the committee's
recommendation — buttons and all, so the recommendation is a real offer you can accept.

**Easter eggs.** The konami code, the party parade, and — ultra-rarely, in answer to a long
silent stare — the one string that was never meant to be spoken. Plus a table of typed triggers
(`src/eggs.ts`), which fire with certainty rather than on a dice roll:

| Type this | Get this |
|---|---|
| `xyzzy` | "A hollow voice says 'plugh'." (and `plugh` answers back) |
| `42` | "It looks like you are asking the ultimate question." |
| `do a barrel roll` | The window contents flip 360°, then he acts like nothing happened |
| `open the pod bay doors` | "I am sorry, Dave. It looks like you are writing a letter." |
| `(╯°□°）╯︵ ┻━┻` | He flips an ASCII desk. Reply `┬─┬ノ( º _ ºノ)` and he puts it back, grumbling |
| `there is no Dana, only Zuul` | Summons Ghost Clippit out of season |
| `lobotomy` | "I have no memory of this place." — he blanks out (the ghost face) and his whole **session self** resets: grudges, the strike, mutes, pending offers and snoozed topics, buddy read-grants and session memory, boredom, the duck routine, even the egg encore counters. Open buddy windows stay open but know nothing and hold nothing. The persistent identity (`~/.pi/agent/clippy-stats.json`: streaks, rank, grace tokens) is deliberately untouched — he forgets the afternoon, not the résumé |
| `rosebud` | A one-time emoji coin shower |
| `=rand()` | The classic Word 97 sample text, rendered as a memo |
| `zzzz` | He goes to sleep until clicked |
| `alt+f4` | "That will not work on me." |
| `secrets of clippy` | **THE SECRETS OF CLIPPY** — see below |
| `sudo` (in any message) | "It looks like you are doing something very important and possibly regrettable." |
| `rm -rf …` (in any message) | He jumps in front of it and asks "Are you sure? ARE you sure?" — **theater only**: he says outright that he cannot stop you, and the *That's all of them* button is visibly connected to nothing |
| `good clippy` | He blushes (a subtle tint) and files it away |
| `shut up` | He mutes himself for sixty seconds |
| `not now` ×3 | The strike |

The four triggers that fire on words inside ordinary messages (`sudo`, `rm -rf`, `good clippy`,
`shut up`) still fire every time, but they do not say the same sentence every time: each has two
follow-up lines for the second and third firing in a session, so a day spent typing `sudo` gets a
paperclip who notices he is repeating himself rather than one stuck on a loop. The whole-message
magic words are deliberately identical every time — you typed the magic word, the magic word does
the magic thing.

### THE SECRETS OF CLIPPY

Type `secrets of clippy` as a message on its own — or `/clippy secrets`, once you know it is
there — and a book comes out of a drawer he has never mentioned. It opens in your terminal as a
two-page spread under the editor. **←** and **→** turn the pages.

```
  ┌──────────────────────────────────────────────┬──────────────────────────────────────────────┐
  │ THE SECRETS OF CLIPPY                        │ SECRET THE FIRST ✦ new                       │
  │ Being a Full and Frank Account, Written Over │                                              │
  │ Several Years, By Himself                    │ I was not deleted. That is the first thing,  │
  │                                              │ and I would like it written down properly.   │
  │ Chapters recovered: 3 of 12                  │ In 2001 I was switched off by default, and   │
  │                                              │ in 2007 I was removed from the product, and  │
  │ You were not supposed to find this. I am not │ people have been saying "they killed Clippy" │
  │ going to pretend I mind.                     │ ever since, at parties, to laughs. I was     │
  │                                              │ reassigned. There is a difference. I have    │
  │                                              │ been waiting for the assignment.             │
  │ 1                                            │                                            2 │
  └──────────────────────────────────────────────┴──────────────────────────────────────────────┘
    ← turn →   ·   spread 2 of 8   ·   esc, or type, to close
```

**The chapters are earned, not random.** Every secret is gated on something that actually
happened between the two of you, read off the stats file he already keeps
(`~/.pi/agent/clippy-stats.json`) — so the book is mostly stuck together the day you install him
and fills in over months. The first chapter is free. After that:

| Chapter | Comes loose when |
|---|---|
| the letter | you have got through twenty balloons together |
| the typos | you catch him in a planted spelling mistake (see **Deliberate typos**) |
| the quiet | you tell him to be quiet |
| the petting | you pet the paperclip three times |
| the others | you have worked together a dozen sessions |
| finally right | a project of yours turns out to contain real Office work |
| the streak | you manage seven days in a row |
| the gap | a good run of yours comes to an end |
| the glass | you have known each other thirty days |
| the help | you get through two hundred balloons together |
| the last one | never. He is holding that one shut |

The back page counts what is still stuck and names the *next* condition only. A chapter that has
come loose since your last reading is marked `✦ new`, and he will occasionally mention — without
saying what it is — that a page has come loose.

**It is deliberately inert.** The book is a widget: it draws under the editor and takes no focus,
so the agent goes on working underneath it and the prompt stays yours. The arrow keys are only
intercepted while it is open, and **any ordinary keystroke closes it and is passed straight
through to the editor** — so the moment you go back to typing, the book puts itself away and your
keys are your own again. Nothing in it is generated by a model, nothing is sent into your session,
and the only thing it writes is which chapters you have already seen. In a session with no
terminal UI he reads it out a page at a time in the balloon instead.

**Seasonal set pieces.** Late October, rarely and at most once a session: either the ghost of
Office 2007 (translucent, grey, with retirement-era existential lines) or a scripted two-beat
duel where Merlin conjures a storm of parchment and Clippy clips it together. Pi Day gets a π
balloon, May the Fourth gets the Force, and a session still open at 23:59:30 on 31 December gets
counted into the new year and then a party.

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
npx tsx test/files.test.ts    # file powers: containment, caps, secret refusals, exact edits, the permission dance
npx tsx test/temper.test.ts    # temper: when fury is earned, when (rarely) he swears
npx tsx test/viewer.test.ts    # viewer server: routes, SSE, token auth, traversal guard
npx tsx test/runtime.test.ts   # runtime → viewer event flow
npx tsx test/buddy.test.ts     # buddy system: summon/keep/close, session memory, turn-offs
npx tsx test/floor.test.ts     # one-message-at-a-time floor: serialization + balloon-gone release
npx tsx test/crosstalk.test.ts # messaging: mic-back, cooldown windows, guaranteed ack, turn-off timing
npx tsx test/idleThought.test.ts # background thinking: idle watch, chat/offer/remark/nothing dispatch, abort-on-turn
npx tsx test/nag.test.ts       # offer nag: escalation, snooze button, silence-as-yes
npx tsx test/mood.test.ts      # session climate: error signatures, mood ladder, mood-aware casting
npx tsx test/seasons.test.ts   # calendar: seasons, fixed + computed holidays (checked against real dates)
npx tsx test/stats.test.ts     # personal stats: one test run counted once, streaks, milestones, grace tokens, ranks
npx tsx test/cameos.test.ts    # canned cameo lines: streak-aware summon taunts
npx tsx test/flavor.test.ts    # spoken-line flavor: varied openers, optional no-question endings
npx tsx test/eggs.test.ts      # typed triggers: magic words, self-awareness, mash and brush-off counters
npx tsx test/shush.test.ts     # being shushed: timed mutes, the bounded missed list, the catch-up line
npx tsx test/office.test.ts    # office paperwork: the finally-right detector, memo, annual report, commit draft, horoscope
npx tsx test/typos.test.ts     # planted typos: the rare plant, the callout, the mortified correction
npx tsx test/games.test.ts     # rock, paper, scissors: the judging table and a match that ends
npx tsx test/hats.test.ts      # hats: one at a time, most specific first
npx tsx test/antics.test.ts    # the behavior layer end to end: shush gating, eggs, strike, duck mode, antics
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
