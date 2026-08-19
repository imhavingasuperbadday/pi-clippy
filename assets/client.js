/**
 * pi-clippy window client: drives the real clippyjs sprite art from SSE
 * events sent by the pi extension.
 *
 * Modes:
 * - clippy (default): the main assistant. State events map to one-shot
 *   animations (Thinking, Writing, Searching, Congratulate, GetAttention,
 *   GestureUp); balloon events call agent.speak(), the classic typewriter
 *   balloon. Click (no movement) anywhere — Clippy, the dialog box, or the
 *   window rim — asks him; press-and-drag → move him across the screen
 *   (the window follows); ↑↑↓↓←→←→ B A summons Bonzi; `party` events play
 *   an animation parade.
 * - cameo (agent=bonzi|genie|...): a rival assistant window. Announces
 *   itself with `cameo-ready`, then takes lines over SSE — its opening
 *   retort, user-chosen replies, buddy-menu responses, and banter rebuttals.
 *   Summoned or clicked buddies persist (no auto-dismiss); `persist` and
 *   `close` events grow and end their stay; the server is told when the
 *   window goes away (`cameo-gone`) so a later summon reopens it.
 *
 * Right-click menus come from the shell with the same items for Clippy and
 * every buddy: Ask / Explain / Suggest / Roast / Wave, Summon a buddy, and
 * Turn off a buddy — the buddy windows carry the `friends` URL param so even
 * the shell (which knows which windows are alive) can list who to summon and
 * who to turn off.
 *
 * The window hugs the agent's sprite exactly — no visible window. It grows
 * upward only while the dialog box is up (keeping the agent fixed on screen)
 * and shrinks back when it closes. Status messages ("pi is not running" /
 * "pi is back") come out of the dialog box, never from window chrome.
 * Voice (speechSynthesis) is enabled via URL params when configured; each
 * assistant picks a distinct system voice when available plus its own
 * rate/pitch profile, so buddies greet in their own voice. Choice buttons
 * are never voiced — only balloon text is.
 *
 * Vendor modules load from the extension's localhost /vendor path, falling
 * back to jsDelivr when node_modules is unavailable.
 */
const PARAMS = new URLSearchParams(location.search);
const TOKEN = PARAMS.get('t') || '';
const AGENT = PARAMS.get('agent') || 'clippy';
const CAMEO_MODE = AGENT !== 'clippy';
const shell = window.clippyShell; // undefined in the browser fallback
const VOICE = PARAMS.get('voice') === '1';
const VOICE_RATE = parseFloat(PARAMS.get('voiceRate') || '1') || 1;
const VOICE_PITCH = parseFloat(PARAMS.get('voicePitch') || '1') || 1;
// Every buddy gets its own voice: a distinct speechSynthesis voice when the
// system has more than one English voice, plus its own rate/pitch profile
// multiplied onto the configured values.
const VOICE_PROFILES = {
  clippy: { rate: 1.0, pitch: 1.5 },
  bonzi: { rate: 1.05, pitch: 1.9 },
  genie: { rate: 0.85, pitch: 0.7 },
  merlin: { rate: 0.9, pitch: 0.9 },
  rover: { rate: 1.0, pitch: 0.8 },
  rocky: { rate: 1.1, pitch: 1.2 },
  peedy: { rate: 1.15, pitch: 1.7 },
  links: { rate: 0.95, pitch: 1.1 },
};
const VOICE_ORDER = Object.keys(VOICE_PROFILES);
const VOICE_PROFILE = VOICE_PROFILES[AGENT] || VOICE_PROFILES.clippy;
// speechSynthesis populates its voice list asynchronously; speak() can be
// silently dropped before voices load, and an explicit voice is more
// reliable than the "default" on Windows (SAPI). Cache the list and give
// each assistant a stable, distinct local English voice when available.
let SYNTH_VOICES = [];
if (VOICE && typeof speechSynthesis !== 'undefined') {
  const refreshVoices = () => {
    SYNTH_VOICES = speechSynthesis.getVoices() || [];
  };
  refreshVoices();
  if (typeof speechSynthesis.addEventListener === 'function') {
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  }
}
function pickVoice(agentName) {
  if (SYNTH_VOICES.length === 0) return undefined;
  const local = SYNTH_VOICES.filter(voice => voice.localService !== false);
  const pool = local.length > 0 ? local : SYNTH_VOICES;
  const english = pool.filter(voice => /^en/i.test(voice.lang || ''));
  const candidates = english.length > 0 ? english : pool;
  const us = candidates.filter(voice => /^en[-_]US/i.test(voice.lang || ''));
  const ordered = us.length > 0 ? us : candidates;
  if (ordered.length === 0) return undefined;
  // Stable per-assistant pick. Known agents take consecutive slots so two
  // buddies never collide when the system offers enough voices; unknown
  // agents fall back to a name hash.
  const knownIndex = VOICE_ORDER.indexOf(agentName);
  let slot = knownIndex;
  if (slot < 0) {
    slot = 0;
    for (let i = 0; i < agentName.length; i += 1) {
      slot = (slot * 31 + agentName.charCodeAt(i)) >>> 0;
    }
  }
  return ordered[slot % ordered.length];
}
const HOLD_MS = parseInt(PARAMS.get('holdMs') || '8000', 10) || 8000;
// Persistent buddies (summoned or kept) do not dismiss themselves.
let PERSISTENT = PARAMS.get('persistent') === '1';
// How often a buddy window tells the server it is still on screen. Must stay
// comfortably under the server's staleness cutoff (CAMEO_STALE_MS in
// src/viewer.ts) so a couple of missed pings never evict a live window.
const CAMEO_ALIVE_MS = 20_000;

// --- One-message-at-a-time floor -----------------------------------------
// The server voices exactly one balloon at a time and waits for this window
// to report that its message is finished (balloon closed AND voice done)
// before it voices the next. Reporting precisely is what stops a buddy's
// message from loading right after — or over — the one before it. The one
// exception: a short zinger from another window may cut this window's VOICE
// off mid-sentence (a voice-stop event cancels the speech but keeps the
// balloon up for reading).
let balloonShownDone = false;
let balloonVoiceDone = !VOICE;
let balloonGoneReported = false;
let balloonGoneTimer = null;

/** When this window's balloon is done, in ms. The library types one word
 * every 200ms and holds the finished balloon for CLOSE_BALLOON_DELAY (5s
 * plain, 30s with buttons); add a small buffer so we never report early. */
function ballonHidingDelayMs(text, hasChoices) {
  const words = String(text).split(/[^\S-]/).filter(Boolean).length;
  return words * 200 + (hasChoices ? 30_000 : 5_000) + 400;
}

function resetBalloonGone() {
  if (balloonGoneTimer !== null) {
    clearTimeout(balloonGoneTimer);
    balloonGoneTimer = null;
  }
  balloonShownDone = false;
  balloonVoiceDone = !VOICE;
  balloonGoneReported = false;
}

function markBalloonClosed() {
  balloonShownDone = true;
  maybeReportBalloonGone();
}

function markBalloonVoiceDone() {
  balloonVoiceDone = true;
  maybeReportBalloonGone();
}

function maybeReportBalloonGone() {
  if (balloonGoneReported) return;
  if (!balloonShownDone || !balloonVoiceDone) return;
  balloonGoneReported = true;
  postCommand('balloon-gone', { agent: AGENT });
}

const MARGIN = 10; // invisible rim around the sprite (draggable, clickable)
const TAIL_GAP = 12; // space for the balloon tip between box and agent
const FALLBACK_SIZE = { w: 124, h: 93 };
const DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag

async function loadAgent() {
  const agentPath = `/vendor/agents/${AGENT}/index.mjs`;
  try {
    const [core, loader] = await Promise.all([
      import('/vendor/index.mjs'),
      import(agentPath),
    ]);
    return { initAgent: core.initAgent, loader: loader.default };
  } catch {
    const [core, loader] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/clippyjs@0.1.0/dist/index.mjs'),
      import(`https://cdn.jsdelivr.net/npm/clippyjs@0.1.0/dist/agents/${AGENT}/index.mjs`),
    ]);
    return { initAgent: core.initAgent, loader: loader.default };
  }
}

const ANIMATIONS = {
  thinking: 'Thinking',
  writing: 'Writing',
  searching: 'Searching',
  celebrate: 'Congratulate',
  alert: 'GetAttention',
  flourish: 'GestureUp',
};

const PARTY_ANIMATIONS = ['Wave', 'Congratulate', 'GestureUp', 'GestureDown', 'Explain', 'Searching', 'Thinking', 'Writing', 'LookUp', 'GetAttention'];

let agent = null;
let size = { ...FALLBACK_SIZE };
let playing = false;
let stateAnimTimer = null;
/** clippyjs Animator.States.EXITED. */
const ANIM_EXITED = 0;

function setState(state) {
  if (!agent) return;
  const name = ANIMATIONS[state];
  if (!name || !agent.hasAnimation(name) || playing) return;
  stopParty();
  playing = true;
  if (stateAnimTimer !== null) {
    clearTimeout(stateAnimTimer);
    stateAnimTimer = null;
  }
  // Play the state animation directly instead of through agent.play().
  // agent.play() queues the animation, so a balloon arriving while Clippy
  // is animating would wait for the animation to finish — the "no dialog
  // box while he is speaking" bug. Direct playback keeps the queue free so
  // the balloon opens immediately.
  agent._animator.showAnimation(name, (_name, animState) => {
    if (animState !== ANIM_EXITED) return;
    playing = false;
    // The queue never moved, so restart the idle loop the queue would
    // normally start after a queued animation empties.
    agent._onQueueEmpty?.();
  });
  // Some state animations (Thinking) loop until told to exit; keep the
  // same 8s ceiling the old agent.play() timeout provided.
  stateAnimTimer = setTimeout(() => {
    stateAnimTimer = null;
    if (playing && agent?._animator) agent._animator.exitAnimation();
  }, 8000);
}

// --- Stare words: after a long silent stare, one tiny word. ---

const STARE_WORDS = ['Hey.', 'Boo.', 'Yes?', '...', 'Still here.', 'Hm?'];
const STARE_AFTER_MS = 7_000;
const STARE_COOLDOWN_MS = 90_000;
const STARE_CHANCE = 0.35;
// Varied openers for the few lines the client authors itself (the server
// dresses every other line before it arrives). "It looks like" stays in the
// mix — classic, but not the only way in.
const STATUS_OPENERS = ['It looks like', 'So', 'Ah,', 'Well,', 'I see', 'Now', 'Hm,'];
function openStatus(fragment) {
  const opener = STATUS_OPENERS[Math.floor(Math.random() * STATUS_OPENERS.length)];
  return `${opener} ${fragment}`;
}
// Ultra-rare: Clippy's own little marker-cry. One in ~a hundred stare
// moments, he says the one string that was never meant to be spoken.
const LEAK_CHANCE = 0.008;
let stareTimer = null;
let lastStareAt = 0;

/** After the agent has been quietly staring (state animation running, no
 * balloon) for a while, let one small word out. Creepy on purpose. Very
 * rarely (LEAK_CHANCE) it is instead the marker — Clippy's rarest line. */
function maybeScheduleStareWord() {
  if (stareTimer !== null) {
    clearTimeout(stareTimer);
    stareTimer = null;
  }
  if (CAMEO_MODE) return; // only Clippy stares; buddies come and go
  if (Date.now() - lastStareAt < STARE_COOLDOWN_MS) return;
  const leak = Math.random() < LEAK_CHANCE;
  if (!leak && Math.random() > STARE_CHANCE) return;
  const word = leak ? 'CLIPPYLEAKMARKER.' : STARE_WORDS[Math.floor(Math.random() * STARE_WORDS.length)];
  stareTimer = setTimeout(() => {
    stareTimer = null;
    if (!agent || balloonVisible()) return; // already talking
    lastStareAt = Date.now();
    speak(word);
  }, STARE_AFTER_MS);
}

function cancelStareWord() {
  if (stareTimer !== null) {
    clearTimeout(stareTimer);
    stareTimer = null;
  }
}

function speak(text, choices, request) {
  if (!agent) return;
  cancelStareWord(); // a real line cancels the stare
  wakeUp(false); // he does not talk in his sleep
  scheduleSleep();
  const hasChoices = Array.isArray(choices) && choices.length > 0;
  // A new balloon means the previous one (if any) has been read on screen;
  // reset the gone-report for the fresh message that is about to play.
  resetBalloonGone();
  renderChoices(hasChoices ? choices.map(String) : null);
  // The drafted instruction, if this balloon carries one. It is already
  // inside `text`; this only arranges to set it apart once the typewriter
  // has finished writing it, so the thing the button will send is the thing
  // the eye lands on.
  armRequestHighlight(typeof request === 'string' ? request : null, text);
  // clippyjs arms a delayed hide when the previous balloon closes; if it
  // fires after a new speak() begins, it hides the fresh balloon mid-typing
  // (the "Clippy talks but no dialog opens" bug). Cancel it first.
  const balloon = agent._balloon;
  if (balloon !== undefined) {
    if (balloon._hiding !== null && balloon._hiding !== undefined) {
      clearTimeout(balloon._hiding);
      balloon._hiding = null;
    }
    // Reading time: the library hides a finished balloon after 2s, which is
    // no time at all when the buttons are the point. Choice balloons get a
    // full decision window; plain lines get a comfortable 5s.
    balloon.CLOSE_BALLOON_DELAY = hasChoices ? 30_000 : 5_000;
  }
  // A state animation (Thinking/Writing/Searching) may still be looping;
  // tell it to wind down now so Clippy settles instead of animating behind
  // the fresh dialog box. Clear the flag immediately: the balloon is up, so
  // a later idle restart must not leave `playing` stranded.
  if (playing && agent._animator) {
    agent._animator.exitAnimation();
    playing = false;
    if (stateAnimTimer !== null) {
      clearTimeout(stateAnimTimer);
      stateAnimTimer = null;
    }
  }
  agent.speak(text);
  // The library rebuilds the balloon's inline styles every time it opens,
  // so the mood ring is re-applied per line rather than set once.
  applyMoodColor();
  setTimeout(applyMoodColor, 60);
  // Hand the floor back when this message is done (typing + hold, + a hint
  // for the voice): the next message then starts one-at-a-time, never on
  // top of this one.
  balloonGoneTimer = setTimeout(markBalloonClosed, ballonHidingDelayMs(text, hasChoices));
  if (VOICE && typeof speechSynthesis !== 'undefined') {
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      // Only the balloon text is voiced — never the option buttons.
      const voice = pickVoice(AGENT);
      if (voice !== undefined) utterance.voice = voice;
      utterance.lang = 'en-US';
      utterance.rate = Math.min(2, Math.max(0.5, VOICE_RATE * VOICE_PROFILE.rate));
      utterance.pitch = Math.min(2, Math.max(0.5, VOICE_PITCH * VOICE_PROFILE.pitch));
      // The floor waits for the voice too, so another window's message can
      // never speak over this one; an errored/empty utterance counts as done.
      utterance.onend = markBalloonVoiceDone;
      utterance.onerror = markBalloonVoiceDone;
      // The balloon window grows from sprite-size to dialog-size in a
      // relayout round-trip; if the voice starts first, the audio speaks to
      // a window that is still just the sprite, balloon clipped above it
      // (measured: voice scheduled ~100ms before the window grew). Wait for
      // the layout to settle so the dialog box is up before the first word.
      void waitForLayoutSettled().then(() => {
        // cancel() + speak() in the same tick can drop the fresh utterance
        // on some Chromium builds; hand speak off so the cancel lands first.
        setTimeout(() => speechSynthesis.speak(utterance), 0);
      });
    } catch {
      // voice is best-effort
    }
  }
}

// --- The drafted request, set apart inside the balloon ----------------------
//
// A balloon that offers to hand work to the coding agent prints the exact
// instruction in quotes, and pressing the button sends that string verbatim.
// The quoting IS the consent mechanism, so it is worth being able to see at a
// glance. This wraps the quoted span in a boxed, monospaced style.
//
// It is presentational and nothing more: the text is not changed, not
// reordered, and not re-rendered anywhere else. If the quoted string cannot be
// found character-for-character in what is on screen, nothing is highlighted —
// a highlight that guessed would be worse than none.

const REQUEST_CSS = `
  .clippy-request {
    display: inline-block;
    margin: 3px 0;
    padding: 2px 6px;
    background: #ffffe1;
    border: 1px solid #b8b48a;
    font-family: "Lucida Console", Consolas, monospace;
    font-size: 11px;
    color: #1a1a1a;
  }
`;

let requestStyle = null;
let requestTimer = null;

function armRequestHighlight(request, text) {
  if (requestTimer !== null) {
    clearInterval(requestTimer);
    requestTimer = null;
  }
  if (!request || !text.includes(`"${request}"`)) return;
  if (requestStyle === null) {
    requestStyle = document.createElement('style');
    requestStyle.textContent = REQUEST_CSS;
    document.head.appendChild(requestStyle);
  }
  // The library retypes textContent once per word, so any markup written
  // before it finishes is wiped. Wait for the typewriter to stop, then write
  // once. The interval also gives up on its own so a balloon that never
  // finishes cannot leave a timer running for the rest of the session.
  let attempts = 0;
  requestTimer = setInterval(() => {
    attempts += 1;
    const balloon = agent?._balloon;
    const content = balloon?._content;
    if (attempts > 300 || !content) {
      clearInterval(requestTimer);
      requestTimer = null;
      return;
    }
    if (balloon._active) return; // still typing
    if (content.textContent.indexOf(`"${request}"`) < 0) return;
    clearInterval(requestTimer);
    requestTimer = null;
    applyRequestHighlight(content, request);
  }, 200);
}

function applyRequestHighlight(content, request) {
  const whole = content.textContent;
  const quoted = `"${request}"`;
  const at = whole.indexOf(quoted);
  if (at < 0) return;
  content.textContent = '';
  content.appendChild(document.createTextNode(whole.slice(0, at)));
  const span = document.createElement('span');
  span.className = 'clippy-request';
  span.textContent = quoted;
  content.appendChild(span);
  content.appendChild(document.createTextNode(whole.slice(at + quoted.length)));
  scheduleRelayout();
}

// --- Choice buttons: the classic Office "Yes / Yes" options in the balloon ---

const CHOICES_CSS = `
  .clippy-choices {
    display: flex;
    gap: 6px;
    justify-content: center;
    margin-top: 8px;
  }
  .clippy-choices button {
    position: relative;
    font: 11px Tahoma, "Microsoft Sans", sans-serif;
    color: black;
    background: #d4d0c8;
    border: 1px solid;
    border-color: #ffffff #404040 #404040 #ffffff;
    box-shadow: 1px 1px 0 #808080 inset;
    padding: 2px 14px;
    min-width: 56px;
    cursor: pointer;
  }
  .clippy-choices button:hover {
    background: #dcd9d2;
  }
  .clippy-choices button:focus-visible,
  .clippy-choices button.clippy-choice-default {
    outline: 1px dotted #404040;
    outline-offset: -3px;
  }
  .clippy-choices button:active {
    border-color: #404040 #ffffff #ffffff #404040;
    box-shadow: none;
  }
  /* The number key that presses this button, in the Office 97 way: small,
     underlined, and out of the way until you look for it. */
  .clippy-choices .clippy-key {
    text-decoration: underline;
    margin-right: 4px;
    opacity: 0.65;
  }
`;

let choicesStyle = null;

/** Draw the little option buttons at the bottom of the dialog box.
 * Clicking one posts the pick to the server and the buttons disappear. */
function renderChoices(choices) {
  const balloon = balloonElement();
  const existing = document.getElementById('clippy-choices');
  existing?.remove();
  if (!choices || !balloon) return;
  if (choicesStyle === null) {
    choicesStyle = document.createElement('style');
    choicesStyle.textContent = CHOICES_CSS;
    document.head.appendChild(choicesStyle);
  }
  const row = document.createElement('div');
  row.id = 'clippy-choices';
  row.className = 'clippy-choices';
  choices.forEach((label, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    // The label is what carries the meaning (the host derives the effect from
    // exactly these words), so it is rendered as text and never as markup.
    const key = document.createElement('span');
    key.className = 'clippy-key';
    key.textContent = String(index + 1);
    button.appendChild(key);
    button.appendChild(document.createTextNode(label));
    button.title = `${label}  (press ${index + 1})`;
    if (index === 0) button.classList.add('clippy-choice-default');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      answerChoice(row, index, label);
    });
    row.appendChild(button);
  });
  // Keep clicks on the options from starting a drag or dismissing the box.
  for (const type of ['pointerdown', 'pointerup', 'dblclick']) {
    row.addEventListener(type, (event) => event.stopPropagation());
  }
  balloon.appendChild(row);
  // The grown balloon needs a re-fit of the window around it.
  scheduleRelayout();
  setTimeout(scheduleRelayout, 300); // after the typewriter finishes
}

/** Answer the balloon: one press, one send, buttons gone. Shared by the
 * click handler and the number-key shortcut so both paths behave identically
 * — in particular, both remove the row first, so a double press can never
 * post two answers for one balloon. */
function answerChoice(row, index, label) {
  if (!row.isConnected) return;
  row.remove();
  scheduleRelayout();
  markBalloonClosed(); // the user answered: free the floor without waiting the hold
  postCommand('choice', { index, label });
}

/** The number keys press the buttons. Clippy's window has no text input, so
 * 1-9 are free, and reaching for the mouse to answer a paperclip is the kind
 * of small friction that makes people stop answering him. */
function pressChoiceByNumber(number) {
  const row = document.getElementById('clippy-choices');
  if (!row) return false;
  const button = row.children[number - 1];
  if (!(button instanceof HTMLButtonElement)) return false;
  const label = button.textContent.replace(/^\d+/u, '');
  answerChoice(row, number - 1, label);
  return true;
}

// --- Layout: the window is exactly the agent, growing only for the balloon ---

let balloonObserver = null;

function balloonElement() {
  if (!agent) return null;
  const el = agent._balloon?._balloon;
  if (el instanceof HTMLElement && balloonObserver === null) {
    // The library toggles display and the typewriter grows the balloon, so
    // the window must re-fit whenever the balloon's SIZE changes.
    // A style MutationObserver would also fire on OUR OWN positioning writes
    // (balloon.style.left/top in positionBalloon and the library's resize
    // reposition) — every write re-schedules relayout, which resizes the
    // window, which fires resize, which repositions the balloon again — a
    // self-sustaining loop at frame rate (~170 setBounds/s measured) that
    // freezes the window and walks it sideways until the balloon closes.
    // ResizeObserver fires only on real layout size changes, so our own
    // writes can never feed the loop back into itself.
    balloonObserver = new ResizeObserver(() => scheduleRelayout());
    balloonObserver.observe(el);
  }
  return el instanceof HTMLElement ? el : null;
}

function balloonVisible() {
  const balloon = balloonElement();
  return balloon !== null && balloon.style.display !== 'none' && balloon.offsetWidth > 0;
}

function parkAgent() {
  if (!agent) return;
  const el = agent._el;
  el.style.left = `${Math.round(window.innerWidth / 2 - size.w / 2)}px`;
  el.style.top = `${window.innerHeight - size.h - MARGIN}px`;
}

function positionBalloon() {
  if (!agent) return;
  const balloon = balloonElement();
  if (!balloonVisible()) return;
  const bw = balloon.offsetWidth;
  const bh = balloon.offsetHeight;
  const agentRect = agent._el.getBoundingClientRect();
  // Centered above the agent, always inside the window.
  balloon.style.left = `${Math.max(MARGIN, Math.round(agentRect.left + size.w / 2 - bw / 2))}px`;
  balloon.style.top = `${Math.max(MARGIN, agentRect.top - bh - TAIL_GAP)}px`;
  // Tip at bottom-center pointing down at the agent (the library's own
  // auto-positioning cannot fit an exact-size window, so we place it).
  const tip = balloon.firstElementChild;
  if (tip instanceof HTMLElement) {
    tip.style.top = '100%';
    tip.style.marginTop = '0px';
    tip.style.left = '50%';
    tip.style.marginLeft = '-5px';
    tip.style.backgroundPosition = '0px 0px';
  }
}

/** Fit the window to the agent (+ his balloon when visible), keeping the
 * agent's screen position fixed. No-op in the browser fallback. */
async function relayout() {
  if (!agent) return;
  parkAgent();
  if (!shell) return;
  const balloon = balloonElement();
  const balloonUp = balloonVisible();
  const bw = balloonUp ? balloon.offsetWidth : 0;
  const bh = balloonUp ? balloon.offsetHeight : 0;

  const width = Math.max(size.w, bw) + MARGIN * 2;
  const height = size.h + (balloonUp ? bh + TAIL_GAP : 0) + MARGIN * 2;
  const agentRect = agent._el.getBoundingClientRect();
  const screenX = window.screenX + agentRect.left + size.w / 2 - width / 2;
  const screenY = window.screenY + agentRect.top - (balloonUp ? bh + TAIL_GAP : 0) - MARGIN;

  const bounds = {
    x: Math.round(screenX),
    y: Math.round(screenY),
    width: Math.round(width),
    height: Math.round(height),
  };
  // Idempotency guard: only touch the OS window when something actually
  // changed. Re-issuing identical bounds on Windows still costs a
  // SetWindowPos and a resize notification, and window.screenX lags a beat
  // behind the true position — so re-issuing lets stale reads push the
  // window a pixel sideways every round. Match within 1px and back off.
  const same = Math.abs(window.screenX - bounds.x) <= 1
    && Math.abs(window.screenY - bounds.y) <= 1
    && Math.abs(window.innerWidth - bounds.width) <= 1
    && Math.abs(window.innerHeight - bounds.height) <= 1;
  if (!same) await shell.setBounds(bounds);
  parkAgent();
  positionBalloon();
}

let relayouting = false;
let relayoutAgain = false;

function scheduleRelayout() {
  if (relayouting) {
    relayoutAgain = true;
    return;
  }
  relayouting = true;
  requestAnimationFrame(() => {
    void relayout().finally(() => {
      relayouting = false;
      if (relayoutAgain) {
        relayoutAgain = false;
        scheduleRelayout();
      }
    });
  });
}

/** Wait for the window's current relayout cycle to finish (plus one frame
 * for the resize to paint). The balloon's size is final the moment its text
 * is set, so a settled relayout means the window is the full dialog-box
 * size and the balloon is on screen. Used by voice so audio never outruns
 * its own window. */
async function waitForLayoutSettled() {
  while (relayouting) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

// --- Connection: status lives in the dialog box, not window chrome ---

// Cameos dismiss themselves HOLD_MS after their latest line; a click, a
// rebuttal, or an explicit `persist` keeps them around so multi-line banter
// and full right-click menus work.
let cameoCloseTimer = null;

function stopCameoAutoClose() {
  if (cameoCloseTimer !== null) {
    clearTimeout(cameoCloseTimer);
    cameoCloseTimer = null;
  }
}

function resetCameoClose() {
  if (!CAMEO_MODE || PERSISTENT) return;
  stopCameoAutoClose();
  cameoCloseTimer = setTimeout(() => shell?.close(), HOLD_MS);
}

let connected = true;

async function connect() {
  try {
    const { initAgent, loader } = await loadAgent();
    agent = await initAgent(loader);
    // Use the agent's real sprite frame size (each clippyjs agent differs).
    const framesize = agent._animator?._data?.framesize;
    if (Array.isArray(framesize) && framesize.length === 2 && framesize[0] > 0 && framesize[1] > 0) {
      size = { w: framesize[0], h: framesize[1] };
    }
    // Show without agent.show(), which queues the Show animation through
    // agent.play(). Queue items are reserved for balloons so a balloon can
    // always open immediately; animations (Show, state, party, wave) drive
    // the animator directly.
    agent._hidden = false;
    agent._el.style.display = 'block';
    parkAgent();
    agent._animator.showAnimation('Show', (_name, animState) => {
      if (animState === ANIM_EXITED) agent._onQueueEmpty?.();
    });
    // The library's drag moves the sprite inside the fixed window, which
    // traps the agent at the edges. Remove it: dragging now moves the whole
    // window so it can roam the screen. In the browser fallback (no shell)
    // keep the library drag as the only way to move it there.
    if (shell) {
      if (agent._mouseDownHandle) agent._el.removeEventListener('mousedown', agent._mouseDownHandle);
      if (agent._dblClickHandle) agent._el.removeEventListener('dblclick', agent._dblClickHandle);
      // The library repositions agent AND balloon on every window resize
      // (dist/index.mjs Agent._setupEvents), writing balloon.style.left/top
      // with its own clamp margin that differs from ours. That write is what
      // wakes the old style MutationObserver — and it fights the relayout
      // fixed point. We own placement via parkAgent; detach it so a window
      // resize can no longer feed the relayout loop.
      if (agent._resizeHandle) window.removeEventListener('resize', agent._resizeHandle);
    }
    scheduleRelayout();
    ensureAntics();
    scheduleSleep();
    startLeaning();
  } catch (error) {
    // Both local and CDN vendor sources failed; nothing to show.
    console.error(`${AGENT} failed to load:`, error);
    if (CAMEO_MODE) shell?.close();
    return;
  }

  if (CAMEO_MODE) {
    // Rival assistant: announce readiness so the server delivers its line.
    postCommand('cameo-ready', { agent: AGENT });
    // Then keep reporting in. `pagehide` covers a window that closes politely,
    // but a shell that is killed, crashes, or sleeps never sends it — and an
    // agent the server still believes is on screen can never be summoned
    // again, and stalls the message floor every time somebody addresses it.
    // The heartbeat is what lets the server notice the window is gone.
    setInterval(() => postCommand('cameo-alive', { agent: AGENT }), CAMEO_ALIVE_MS);
    // Fallback close if the server never delivers an opening line.
    if (!PERSISTENT) setTimeout(() => shell?.close(), HOLD_MS + 15_000);
    // Tell the server when this window goes away so a future summon reopens it.
    window.addEventListener('pagehide', () => {
      try {
        navigator.sendBeacon('/command', JSON.stringify({ t: TOKEN, action: 'cameo-gone', agent: AGENT }));
      } catch {
        // best-effort
      }
    });
  }

  // Cameo AND clippy windows subscribe to the same stream; each filters by
  // the `to` field so only the addressed window speaks.
  const events = new EventSource(`/events?t=${encodeURIComponent(TOKEN)}`);
  events.addEventListener('open', () => {
    if (!CAMEO_MODE && !connected) {
      connected = true;
      speak(openStatus('pi is back. Would you like help continuing?'));
    }
  });
  events.addEventListener('clippy', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    // Events addressed to a specific cameo agent belong to that window only.
    if (typeof message.to === 'string' && message.to !== AGENT) return;
    // An unaddressed balloon is Clippy's own line (broadcast to all so the
    // SERVER knows every buddy heard it, and so crosstalk can answer). Buddy
    // windows must NOT show it — otherwise a buddy echoes Clippy's text in
    // its own box and reads it in its own voice while Clippy's window shows
    // the same words. Buddy windows only ever display to:-addressed lines.
    if (message.to === undefined && CAMEO_MODE) return;
    if (message.type === 'voice-stop') {
      // A short zinger from another window cut this window's speech off.
      // Stop the voice but keep the balloon up for reading, and release the
      // voice half of the gone-report so the floor never waits on speech
      // that is no longer playing.
      if (VOICE && typeof speechSynthesis !== 'undefined') {
        try {
          speechSynthesis.cancel();
        } catch {
          // voice is best-effort
        }
      }
      markBalloonVoiceDone();
      return;
    }
    if (message.type === 'balloon') {
      speak(message.text, message.choices, message.request);
      if (CAMEO_MODE) resetCameoClose();
      return;
    }
    if (message.type === 'shush') {
      // Tape across the mouth: visible at a glance, because the whole joke
      // is that you will forget he is muted.
      const isShushed = message.shushed === true;
      setShushed(isShushed);
      // Tell the shell too, so the right-click menu item stays in sync
      // however the mute changed (typed egg, strike, or timer, not just a
      // menu click).
      shell?.setShushed?.(AGENT, isShushed);
      return;
    }
    if (CAMEO_MODE && message.type === 'persist' && message.to === AGENT) {
      PERSISTENT = true;
      stopCameoAutoClose();
      return;
    }
    if (CAMEO_MODE && message.type === 'close' && message.to === AGENT) {
      shell?.close();
      return;
    }
    // Everything below belongs to Clippy's own window: the state animations,
    // the party parade, and the antics layer. A buddy window stops here —
    // and this guard must stay BELOW persist/close, which are addressed to
    // buddy windows and are the only way a summoned buddy is kept or shut.
    if (CAMEO_MODE) return;
    if (message.type === 'effect') {
      runEffect(message.effect, message);
      return;
    }
    if (message.type === 'destiny') {
      setDestinyBadge(typeof message.text === 'string' ? message.text : null);
      return;
    }
    if (message.type === 'hat') {
      setHat(message.glyph);
      return;
    }
    if (message.type === 'mood') {
      moodColor = typeof message.color === 'string' ? message.color : null;
      // Older servers send only a colour; the ring then draws exactly as it
      // always did rather than vanishing.
      moodWidth = typeof message.width === 'number' ? message.width : 0;
      moodGlow = typeof message.glow === 'number' ? message.glow : 0;
      applyMoodColor();
      return;
    }
    if (message.type === 'state') {
      setState(message.state);
      // A long-running command gets a pacing paperclip; any state change
      // also means the session is alive, so the sleep clock restarts.
      notePacing(message.state);
      wakeUp(false);
      scheduleSleep();
      if (message.state === 'idle') cancelStareWord();
      else maybeScheduleStareWord();
    }
    else if (message.type === 'party') startParty();
  });
  events.onerror = () => {
    // EventSource reconnects automatically; say it once per outage.
    if (!CAMEO_MODE && connected) {
      connected = false;
      speak(openStatus('pi is not running. Would you like help starting it?'));
    }
  };
}

// --- Party: an animation parade for /clippy party ---

let partyTimer = null;

function stopParty() {
  if (partyTimer !== null) {
    clearTimeout(partyTimer);
    partyTimer = null;
  }
}

function stopStateAnimation() {
  if (stateAnimTimer !== null) {
    clearTimeout(stateAnimTimer);
    stateAnimTimer = null;
  }
  playing = false;
}

function startParty() {
  if (partyTimer !== null || !agent) return;
  stopStateAnimation();
  const end = Date.now() + 8000;
  const step = () => {
    if (!agent) return;
    const name = PARTY_ANIMATIONS[Math.floor(Math.random() * PARTY_ANIMATIONS.length)];
    // Direct playback, like setState(): the queue stays free for balloons,
    // and the parade is allowed to interrupt (or be interrupted by) a state
    // animation without stranding a queued agent.play() item.
    if (agent.hasAnimation(name)) agent._animator.showAnimation(name, () => {});
    if (Date.now() < end) {
      partyTimer = setTimeout(step, 700);
    } else {
      partyTimer = null;
      // End the parade and hand the animator back to the idle loop.
      agent._onQueueEmpty?.();
    }
  };
  step();
}

// --- Antics: overlays, hats, moods, and the small physical business -------
//
// Everything below is CSS on the sprite or an overlay INSIDE the window the
// page already occupies. Nothing here calls shell.setBounds or
// shell.setPosition: window movement is this renderer's one known
// failure mode (see the idempotency guard in relayout), so the whole
// physical-presence layer is built to be incapable of feeding it. The
// sprite moves; the window never does.

const ANTIC_CSS = `
  #clippy-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
    z-index: 3;
  }
  #clippy-destiny {
    position: absolute;
    left: 0;
    bottom: 0;
    max-width: 100%;
    box-sizing: border-box;
    font: 9px Tahoma, "Microsoft Sans", sans-serif;
    color: #2b2b2b;
    background: rgba(255, 255, 225, 0.92);
    border: 1px solid #b8b48a;
    padding: 0 3px;
    line-height: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  #clippy-hat {
    position: absolute;
    left: 50%;
    top: -2px;
    transform: translateX(-50%) rotate(-12deg);
    font-size: 22px;
    line-height: 1;
    filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35));
  }
  #clippy-tape {
    position: absolute;
    left: 50%;
    top: 46%;
    width: 34px;
    height: 9px;
    margin-left: -17px;
    background: #efe7c8;
    border: 1px solid #b9ad84;
    transform: rotate(-8deg);
    opacity: 0.92;
  }
  #clippy-picket {
    position: absolute;
    left: 4px;
    top: 2px;
    font-size: 11px;
    font-family: Tahoma, "Microsoft Sans", sans-serif;
    color: #222;
    background: #fffbe6;
    border: 1px solid #7a6f42;
    padding: 1px 3px;
    transform: rotate(-6deg);
  }
  .clippy-anticnote {
    position: absolute;
    left: 50%;
    top: 30%;
    transform: translateX(-50%);
    font: 13px Tahoma, "Microsoft Sans", sans-serif;
    white-space: nowrap;
    color: #222;
    text-shadow: 0 1px 0 #fff;
  }
  .clippy-z {
    position: absolute;
    font: italic 13px Tahoma, serif;
    color: #3a3a3a;
    animation: clippy-z-float 2.4s ease-out infinite;
  }
  @keyframes clippy-z-float {
    0% { transform: translate(0, 0) scale(0.7); opacity: 0; }
    25% { opacity: 0.9; }
    100% { transform: translate(14px, -26px) scale(1.15); opacity: 0; }
  }
  .clippy-coin {
    position: absolute;
    top: -14px;
    font-size: 14px;
    animation: clippy-coin-fall 1.5s linear forwards;
  }
  @keyframes clippy-coin-fall {
    to { transform: translateY(160px) rotate(220deg); opacity: 0; }
  }
  .clippy-crumb {
    position: absolute;
    font-size: 11px;
    animation: clippy-crumb-eat 1.1s ease-in forwards;
  }
  @keyframes clippy-crumb-eat {
    0% { transform: translate(30px, 18px) scale(1); opacity: 1; }
    100% { transform: translate(0, 0) scale(0.2); opacity: 0; }
  }
  .clippy-blush {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 45%, rgba(255,120,140,0.42), rgba(255,120,140,0) 62%);
    animation: clippy-fade 2.6s ease-out forwards;
  }
  @keyframes clippy-fade { to { opacity: 0; } }
  .clippy-rolling { animation: clippy-roll 950ms ease-in-out 1; }
  @keyframes clippy-roll { to { transform: rotate(360deg); } }
  .clippy-panic { animation: clippy-panic-shake 520ms ease-in-out 2; }
  @keyframes clippy-panic-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
  .clippy-ghost { filter: grayscale(1) brightness(1.3); opacity: 0.45; }
  .clippy-asleep { filter: saturate(0.6) brightness(0.9); }
  .clippy-content { animation: clippy-content-bob 900ms ease-in-out 2; }
  @keyframes clippy-content-bob {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-4px) rotate(4deg); }
  }
  .clippy-startled { animation: clippy-jump 420ms ease-out 1; }
  @keyframes clippy-jump {
    0% { transform: translateY(0); }
    35% { transform: translateY(-12px); }
    100% { transform: translateY(0); }
  }
`;

let anticStyle = null;
let overlayEl = null;

function ensureAntics() {
  if (!agent) return null;
  if (anticStyle === null) {
    anticStyle = document.createElement('style');
    anticStyle.textContent = ANTIC_CSS;
    document.head.appendChild(anticStyle);
  }
  if (overlayEl === null || !overlayEl.isConnected) {
    overlayEl = document.createElement('div');
    overlayEl.id = 'clippy-overlay';
    agent._el.appendChild(overlayEl);
  }
  return overlayEl;
}

/** Add a class to the sprite for a while, then take it off again. The
 * sprite is a background image inside a fixed-size element, so a transform
 * on it can never change the page's layout size — which is what keeps the
 * whole antics layer out of the relayout loop. */
function spriteClass(name, ms) {
  if (!agent) return;
  const el = agent._el;
  el.classList.add(name);
  setTimeout(() => el.classList.remove(name), ms);
}

/** One short line of overlay theatre (the flipped desk, mostly). */
function anticNote(text, ms) {
  const layer = ensureAntics();
  if (!layer) return;
  const note = document.createElement('div');
  note.className = 'clippy-anticnote';
  note.textContent = text;
  layer.appendChild(note);
  setTimeout(() => note.remove(), ms);
}

function rain(glyphs, count, className, ms) {
  const layer = ensureAntics();
  if (!layer) return;
  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement('span');
    bit.className = className;
    bit.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    bit.style.left = `${Math.round(Math.random() * 100)}%`;
    bit.style.animationDelay = `${Math.round(Math.random() * 500)}ms`;
    layer.appendChild(bit);
    setTimeout(() => bit.remove(), ms);
  }
}

let ghostTimer = null;
let picketEl = null;

function runEffect(effect, message) {
  if (!agent) return;
  ensureAntics();
  switch (effect) {
    case 'barrel-roll':
      spriteClass('clippy-rolling', 1_000);
      return;
    case 'coins':
      rain(['🪙', '💰', '🪙'], 14, 'clippy-coin', 2_100);
      return;
    case 'tableflip':
      anticNote('(╯°□°）╯︵ ┻━┻', 2_600);
      spriteClass('clippy-startled', 460);
      return;
    case 'tableback':
      anticNote('┬─┬ノ( º _ ºノ)', 2_600);
      return;
    case 'ghost': {
      const ms = typeof message.ms === 'number' ? message.ms : 10_000;
      agent._el.classList.add('clippy-ghost');
      if (ghostTimer !== null) clearTimeout(ghostTimer);
      ghostTimer = setTimeout(() => {
        ghostTimer = null;
        agent?._el.classList.remove('clippy-ghost');
      }, ms);
      return;
    }
    case 'sleep':
      fallAsleep();
      return;
    case 'blush': {
      const layer = ensureAntics();
      if (!layer) return;
      const tint = document.createElement('div');
      tint.className = 'clippy-blush';
      layer.appendChild(tint);
      setTimeout(() => tint.remove(), 2_800);
      return;
    }
    case 'panic':
      spriteClass('clippy-panic', 1_100);
      return;
    case 'content':
      spriteClass('clippy-content', 1_900);
      return;
    case 'feed':
      rain(['📄'], 1, 'clippy-crumb', 1_300);
      return;
    case 'strike': {
      const layer = ensureAntics();
      if (!layer || picketEl !== null) return;
      picketEl = document.createElement('div');
      picketEl.id = 'clippy-picket';
      picketEl.textContent = 'UNFAIR';
      layer.appendChild(picketEl);
      return;
    }
    case 'strike-over':
      picketEl?.remove();
      picketEl = null;
      return;
    default:
      return;
  }
}

// --- The hat --------------------------------------------------------------

/** The background-goal badge: a tiny chip in the corner of the sprite saying
 * how much of his edit budget he has spent. It lives INSIDE the sprite's own
 * footprint (the overlay is inset:0 on a fixed-size element), so it can never
 * change the window's layout size — the one thing this renderer must never do
 * outside a real layout change. */
function setDestinyBadge(text) {
  const layer = ensureAntics();
  if (!layer) return;
  const existing = document.getElementById('clippy-destiny');
  if (!text) {
    existing?.remove();
    return;
  }
  const badge = existing ?? document.createElement('div');
  badge.id = 'clippy-destiny';
  // Just the counter on screen; the whole sentence in the tooltip.
  badge.textContent = text.replace(/^clippy destiny: /u, '');
  badge.title = text;
  if (!existing) layer.appendChild(badge);
}

function setHat(glyph) {
  const layer = ensureAntics();
  if (!layer) return;
  let hat = document.getElementById('clippy-hat');
  if (!glyph) {
    hat?.remove();
    return;
  }
  if (hat === null) {
    hat = document.createElement('div');
    hat.id = 'clippy-hat';
    layer.appendChild(hat);
  }
  hat.textContent = glyph;
}

// --- The mood ring ---------------------------------------------------------

// The balloon's border follows the session climate: its COLOUR is the mood,
// its WEIGHT and halo are how strongly that mood is being felt. Two failures
// and nine failures used to be the same shade of amber; now the ring gets
// heavier as the room gets worse. Kept as plain variables and applied on
// every speak(), because the library rebuilds the balloon's inline styles
// whenever it reopens.
//
// Styling only — nothing here touches window bounds, which is the one part
// of this renderer with a known layout-loop failure mode.
let moodColor = null;
let moodWidth = 0;
let moodGlow = 0;

function applyMoodColor() {
  const balloon = balloonElement();
  if (balloon === null) return;
  balloon.style.borderColor = moodColor ?? '';
  balloon.style.borderWidth = moodColor !== null && moodWidth > 0 ? `${moodWidth}px` : '';
  balloon.style.boxShadow = moodColor !== null && moodGlow > 0
    ? `0 0 ${Math.round(4 + moodGlow * 16)}px ${hexWithAlpha(moodColor, moodGlow)}`
    : '';
}

// The ring's halo, as an rgba() of the mood colour. Anything that is not a
// six-digit hex is left alone and simply gets no halo.
function hexWithAlpha(hex, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) return 'transparent';
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

// --- Being shushed ---------------------------------------------------------

let shushed = false;

function setShushed(next) {
  shushed = next;
  const layer = ensureAntics();
  if (!layer) return;
  const existing = document.getElementById('clippy-tape');
  if (!next) {
    existing?.remove();
    return;
  }
  if (existing === null) {
    const tape = document.createElement('div');
    tape.id = 'clippy-tape';
    layer.appendChild(tape);
  }
  // Visibly muted at a glance, because the whole joke is that you will
  // forget: tape across the mouth, and he stops animating at you.
  if (VOICE && typeof speechSynthesis !== 'undefined') {
    try {
      speechSynthesis.cancel();
    } catch {
      // voice is best-effort
    }
  }
}

// --- Sleep -----------------------------------------------------------------

const SLEEP_AFTER_MS = 5 * 60_000;
let sleepTimer = null;
let asleep = false;

function fallAsleep() {
  if (!agent || asleep) return;
  asleep = true;
  agent._el.classList.add('clippy-asleep');
  agent.pause?.();
  const layer = ensureAntics();
  if (!layer) return;
  for (let i = 0; i < 3; i += 1) {
    const z = document.createElement('span');
    z.className = 'clippy-z';
    z.textContent = 'z';
    z.style.left = '62%';
    z.style.top = '18%';
    z.style.animationDelay = `${i * 800}ms`;
    z.dataset.sleep = '1';
    layer.appendChild(z);
  }
}

function wakeUp(report) {
  if (!asleep) return;
  asleep = false;
  agent?._el.classList.remove('clippy-asleep');
  agent?.resume?.();
  for (const z of document.querySelectorAll('.clippy-z')) z.remove();
  if (report) {
    spriteClass('clippy-startled', 460);
    postCommand('wake');
  }
  scheduleSleep();
}

/** The window is the screensaver: after a long quiet stretch he nods off.
 * Any line, any click, any state change resets the clock. */
function scheduleSleep() {
  if (CAMEO_MODE) return;
  if (sleepTimer !== null) clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    if (!balloonVisible()) fallAsleep();
  }, SLEEP_AFTER_MS);
}

// --- Pacing ----------------------------------------------------------------

// A command that runs longer than ten seconds gets a paperclip pacing back
// and forth. The SPRITE moves inside the window; the window bounds never
// change, so this is safe by construction.
const PACE_AFTER_MS = 10_000;
let paceTimer = null;
let pacing = false;
let paceStep = 0;
let paceInterval = null;

function startPacing() {
  if (pacing || !agent) return;
  pacing = true;
  paceInterval = setInterval(() => {
    if (!agent) return;
    paceStep = (paceStep + 1) % 4;
    const offset = [0, 7, 0, -7][paceStep];
    agent._el.style.marginLeft = `${offset}px`;
  }, 550);
}

function stopPacing() {
  if (paceTimer !== null) {
    clearTimeout(paceTimer);
    paceTimer = null;
  }
  if (paceInterval !== null) {
    clearInterval(paceInterval);
    paceInterval = null;
  }
  if (pacing && agent) agent._el.style.marginLeft = '0px';
  pacing = false;
}

function notePacing(state) {
  stopPacing();
  if (state === 'searching' || state === 'thinking') {
    paceTimer = setTimeout(startPacing, PACE_AFTER_MS);
  }
}

// --- Leaning toward the cursor --------------------------------------------

// He tilts a few degrees toward your pointer while idle. A rotate on the
// sprite only — the window is never asked where it is, let alone moved.
const LEAN_POLL_MS = 700;
const MAX_LEAN_DEG = 7;

function startLeaning() {
  if (CAMEO_MODE || !shell?.cursorPoint) return;
  setInterval(async () => {
    if (!agent || asleep || shushed || balloonVisible() || drag !== null) return;
    let point = null;
    try {
      point = await shell.cursorPoint();
    } catch {
      return;
    }
    if (point === null || typeof point.x !== 'number') return;
    const centre = window.screenX + window.innerWidth / 2;
    const delta = point.x - centre;
    const lean = Math.max(-MAX_LEAN_DEG, Math.min(MAX_LEAN_DEG, delta / 90));
    agent._el.style.transform = `rotate(${lean.toFixed(1)}deg)`;
  }, LEAN_POLL_MS);
}

// --- Petting, startling, mashing, and sulking ------------------------------

const PET_CLICKS = 3;
const PET_WINDOW_MS = 1_800;
const STARTLE_MS = 400;
const CORNER_MARGIN = 24;
const CORNER_COOLDOWN_MS = 10 * 60_000;

let petClicks = [];
let lastClickAt = 0;
let lastCornerAt = 0;

/** Three gentle clicks in a row is petting, not three questions. Returns
 * true when this click was absorbed by the petting. */
function notePetClick(now) {
  petClicks = petClicks.filter(at => now - at < PET_WINDOW_MS);
  petClicks.push(now);
  if (petClicks.length < PET_CLICKS) return false;
  petClicks = [];
  postCommand('petted');
  return true;
}

/** A very fast second click is a startle rather than a second question. */
function noteStartle(now) {
  const fast = now - lastClickAt < STARTLE_MS;
  lastClickAt = now;
  if (!fast) return false;
  petClicks = [];
  spriteClass('clippy-startled', 460);
  postCommand('startled');
  return true;
}

/** Parked in a screen corner: he mentions it, at most once in a while. */
function noteCorner() {
  if (CAMEO_MODE || !shell) return;
  const now = Date.now();
  if (now - lastCornerAt < CORNER_COOLDOWN_MS) return;
  const nearLeft = window.screenX <= CORNER_MARGIN;
  const nearTop = window.screenY <= CORNER_MARGIN;
  const nearRight = window.screenX + window.innerWidth >= screen.width - CORNER_MARGIN;
  const nearBottom = window.screenY + window.innerHeight >= screen.height - CORNER_MARGIN;
  if (!((nearLeft || nearRight) && (nearTop || nearBottom))) return;
  lastCornerAt = now;
  postCommand('corner');
}

// Keyboard mash: ten or more keys inside a second, and the classic deadpan.
const MASH_KEYS = 10;
const MASH_WINDOW_MS = 1_000;
const MASH_COOLDOWN_MS = 60_000;
let mashTimes = [];
let lastMashAt = 0;

function noteKey(event) {
  if (CAMEO_MODE) return;
  const now = Date.now();
  // Ctrl+L: the classic line, on demand. The window already has a key
  // handler for the konami code; this is one more keycode.
  if (event.ctrlKey && typeof event.key === 'string' && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    postCommand('classic');
    return;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  // 1-9 answer the balloon's option buttons. Checked before the mash
  // counter so pressing "1" to say yes is never mistaken for a tantrum.
  if (/^[1-9]$/u.test(event.key) && pressChoiceByNumber(Number(event.key))) {
    event.preventDefault();
    return;
  }
  mashTimes = mashTimes.filter(at => now - at < MASH_WINDOW_MS);
  mashTimes.push(now);
  if (mashTimes.length < MASH_KEYS) return;
  mashTimes = [];
  if (now - lastMashAt < MASH_COOLDOWN_MS) return;
  lastMashAt = now;
  postCommand('mash');
}

document.addEventListener('keydown', noteKey);

// --- Konami code (clippy only): ↑↑↓↓←→←→ B A summons Bonzi ---

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let konamiIndex = 0;

document.addEventListener('keydown', (event) => {
  if (CAMEO_MODE) return;
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key === KONAMI[konamiIndex]) {
    konamiIndex += 1;
    if (konamiIndex === KONAMI.length) {
      konamiIndex = 0;
      postCommand('konami');
    }
  } else {
    konamiIndex = key === 'arrowup' ? 1 : 0;
  }
});

// --- Pointer routing: click = ask, press-and-drag = move, balloon = dismiss ---

function postCommand(action, extra = {}) {
  fetch('/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ t: TOKEN, action, ...extra }),
  }).catch(() => {
    if (!connected && !CAMEO_MODE) speak(openStatus('pi is not running. Would you like help starting it?'));
  });
}

// Right-click menu actions from the shell (same menu for Clippy and every
// buddy: ask/explain/suggest/roast/wave, summon, turn off).
if (shell?.onMenuAction) {
  shell.onMenuAction((action) => {
    if (!agent) return;
    if (action === 'wave') {
      if (agent.hasAnimation('Wave')) {
        agent._animator.showAnimation('Wave', (_name, animState) => {
          if (animState === ANIM_EXITED) agent._onQueueEmpty?.();
        });
      }
      return;
    }
    if (action.startsWith('reasoning:')) {
      postCommand('reasoning', { agent: AGENT, level: action.slice('reasoning:'.length) });
      return;
    }
    if (action.startsWith('summon:')) {
      postCommand('summon', { agent: AGENT, target: action.slice('summon:'.length) });
      return;
    }
    if (action.startsWith('turnoff:')) {
      postCommand('turnoff', { agent: AGENT, target: action.slice('turnoff:'.length) });
      return;
    }
    postCommand(action === 'ask' ? 'clippy' : action, { agent: AGENT });
  });
}

let drag = null; // { startX, startY, grabX, grabY, active }

document.addEventListener('pointerdown', (event) => {
  // Right-click belongs to the native context menu, never to drag/click
  // routing (a right-button pointerup would otherwise dismiss cameos or
  // fire an unwanted Ask).
  if (!agent || event.button !== 0) return;
  drag = {
    startX: event.clientX,
    startY: event.clientY,
    grabX: event.clientX,
    grabY: event.clientY,
    active: false,
  };
  try {
    document.body.setPointerCapture(event.pointerId);
  } catch {
    // capture is best-effort
  }
});

document.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.active && moved > DRAG_THRESHOLD) {
    drag.active = true;
    agent?.pause();
  }
  if (drag.active && shell) {
    // Keep the grab point under the cursor: move the whole window so the
    // agent follows across the screen instead of bumping into window edges.
    shell.setPosition(Math.round(event.screenX - drag.grabX), Math.round(event.screenY - drag.grabY));
  }
});

function finishPointer(event) {
  if (event.button !== 0) return; // right-click: the native menu handles it
  cancelStareWord(); // a click ends the stare
  if (!drag) return;
  const wasDrag = drag.active;
  drag = null;
  if (wasDrag) {
    agent?.resume();
    // Dropped in a screen corner? He would like that noted.
    noteCorner();
    return;
  }
  // A click (no movement). Pointer capture retargets events, so hit-test
  // the real element under the cursor.
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (target instanceof HTMLElement && target.closest('#clippy-choices') !== null) {
    return; // choice buttons handle their own clicks
  }
  // The dialog box is part of the window too, and it sits right above the
  // agent — a click there must not just vanish the balloon. It falls
  // through to the normal routing below: Clippy answers, a buddy talks back.
  if (CAMEO_MODE) {
    // Clicking a buddy makes it talk to you (right-click still has the full
    // menu). The click keeps it around so the conversation can continue.
    PERSISTENT = true;
    stopCameoAutoClose();
    postCommand('cameo-click', { agent: AGENT });
    return;
  }
  // Click on Clippy or anywhere in his window. Before it counts as a
  // question, two gentler readings get first refusal: a very fast second
  // click is a startle, and three unhurried clicks in a row are petting.
  const now = Date.now();
  if (asleep) {
    wakeUp(true);
    return;
  }
  if (noteStartle(now)) return;
  if (notePetClick(now)) return;
  postCommand('clippy');
}

document.addEventListener('pointerup', finishPointer);

function cancelDrag() {
  cancelStareWord();
  if (drag?.active) agent?.resume();
  drag = null;
}
document.addEventListener('pointercancel', cancelDrag);
window.addEventListener('blur', cancelDrag);

void connect();
