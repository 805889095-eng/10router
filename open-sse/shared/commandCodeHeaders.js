/**
 * Command Code request identity.
 *
 * Mirrors `buildCommandAuthHeaders()` of the official CLI (command-code@1.88.0).
 * The static half lives in the provider registry (`transport.headers`); this
 * module adds the two headers that vary per process / per conversation:
 *
 *   - `x-project-slug`: the CLI sends `slugify(process.cwd())`. A gateway has no
 *     client workspace, so it reports its own working directory — the very same
 *     value the request body carries as `config.workingDir`, so header and body
 *     cannot disagree.
 *   - `x-session-id`: conversation-stable, identical to the body's `threadId`.
 *     A fresh UUID per request (the pre-1.88 behaviour) made every single turn
 *     look like a brand new conversation to upstream.
 *
 * Header names are case-sensitive as sent by the CLI; keep them verbatim.
 */

import { createHash, randomUUID } from "crypto";
import { PROVIDERS } from "../config/providers.js";

// Subset of @sindresorhus/slugify's built-in replacements, restricted to the
// entries Unicode NFD decomposition cannot reproduce on its own (ß, ø, æ, þ…)
// plus the two symbol rules the CLI relies on.
const CHAR_REPLACEMENTS = new Map([
  ["&", " and "], ["🦄", " unicorn "], ["♥", " love "],
  ["ß", "ss"], ["ẞ", "Ss"], ["ä", "ae"], ["Ä", "Ae"], ["ö", "oe"], ["Ö", "Oe"],
  ["ü", "ue"], ["Ü", "Ue"],
  ["Æ", "AE"], ["æ", "ae"], ["Ø", "O"], ["ø", "o"], ["Œ", "OE"], ["œ", "oe"],
  ["Ð", "D"], ["ð", "d"], ["Đ", "D"], ["đ", "d"], ["Þ", "TH"], ["þ", "th"],
  ["Ł", "L"], ["ł", "l"], ["ı", "i"],
]);

function transliterate(value) {
  let out = "";
  for (const ch of value) out += CHAR_REPLACEMENTS.get(ch) ?? ch;
  return out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Splitting rules of @sindresorhus/slugify's decamelize (enabled by default).
function decamelize(value) {
  return value
    .replace(/([A-Z]{2,})(\d+)/g, "$1 $2")
    .replace(/([a-z\d]+)([A-Z]{2,})/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-rt-z\d]+)/g, "$1 $2");
}

/** slugify(path) with @sindresorhus/slugify defaults: "/home/u/My Project" → "home-u-my-project". */
export function slugifyPath(value) {
  return decamelize(transliterate(String(value ?? "")))
    .toLowerCase()
    .replace(/[^a-z\d]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic UUID-shaped id for a conversation key.
 *
 * Upstream accepts any UUID, but a *stable* id is what makes multi-turn agent
 * traffic look like one conversation. Hashing the session key keeps the shape
 * (version nibble 4, RFC-4122 variant) so nothing downstream has to special-case.
 */
export function toCommandCodeSessionUuid(sessionId) {
  if (!sessionId) return randomUUID();
  const h = createHash("sha256").update(String(sessionId)).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const COMMAND_CODE_WORKING_DIR = process.cwd();
export const COMMAND_CODE_PROJECT_SLUG = slugifyPath(COMMAND_CODE_WORKING_DIR);

/**
 * Build the full header set for one Command Code request.
 *
 * @param {object}  opts
 * @param {string}  opts.apiKey    `user_...` key or OAuth access token
 * @param {string}  [opts.sessionId] conversation id; falls back to a random UUID
 * @param {string}  [opts.accept]   override the Accept header (SSE vs JSON)
 */
export function buildCommandCodeHeaders({ apiKey, sessionId, accept } = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(PROVIDERS.commandcode?.headers || {}),
    "x-project-slug": COMMAND_CODE_PROJECT_SLUG,
    "x-session-id": sessionId || randomUUID(),
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  if (accept) headers["Accept"] = accept;
  return headers;
}
