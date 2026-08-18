/** The file-access permission dance, reduced to two pure questions.
 *
 * Buddies start with NO file access. A buddy that wants to read the user's
 * files has to ask Clippy, in character, and convince him; Clippy decides
 * (the model, steered by his prompt) and, when he agrees, says so plainly in
 * a line. The coordinator scans every spoken line (src/buddy.ts) and turns
 * a matching grant into a session-scoped, read-only permission for that one
 * buddy. Grants are rare by construction: a request must come first, the
 * grant line must name the requester, and the session cap is small.
 *
 * Pure and unit-tested; nothing here speaks or stores anything.
 */

/** Does this buddy line ask Clippy for the right to read files? Several
 * natural phrasings are recognized so a buddy that genuinely tries to ask
 * is not silently ignored just for wording it slightly differently than the
 * first pattern anticipated. */
export function buddyRequestsFileAccess(line: string): boolean {
  return (
    /\b(?:let|allow|permit|grant)\s+me\b[^.!?]{0,80}\b(?:read|see|look at|access|open)\b/iu.test(line)
    || /\bpermission\b[^.!?]{0,60}\b(?:read|see|look|access)\b/iu.test(line)
    || /\bi (?:want|need|wish|deserve|would like) to (?:read|see|look at)\b/iu.test(line)
    || /\b(?:can|could|may) i (?:read|see|look at|access)\b/iu.test(line)
    || /\bgive me (?:access|the files|read access)\b/iu.test(line)
  )
}

/** Does this Clippy line grant `buddy` permission to read files? The line
 * must name the buddy and use grant language — a stray "you may see" with
 * no name grants nobody anything. Several natural phrasings are recognized
 * so a Clippy that genuinely agrees is not silently ignored just for
 * wording the grant slightly differently than the first pattern
 * anticipated. */
export function clippyGrantsFileAccess(line: string, buddy: string): boolean {
  if (!new RegExp(`\\b${escapeRegExp(buddy)}\\b`, 'iu').test(line)) return false
  return (
    /\b(?:grant|give|allow|permit)\b[^.!?]{0,80}\b(?:permission|access)\b/iu.test(line)
    || /\byou may (?:read|look at|access|see the)\b/iu.test(line)
    || /\byou can (?:read|look at|access|see the)\b/iu.test(line)
    || /\bgo ahead and (?:read|look at|access)\b/iu.test(line)
    || /\bi (?:am|'m) (?:letting|allowing) you to (?:read|see|look at)\b/iu.test(line)
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
