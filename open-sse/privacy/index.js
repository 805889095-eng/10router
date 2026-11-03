// Privacy redaction & restore pipeline — public surface.
//
// Outbound: secretScanner redacts sensitive strings in the request body into
// deterministic placeholders (cache-friendly), recording the mapping on a
// per-request context. Inbound: streamRestorer reverses placeholders on the
// way back — both one-shot (non-streaming JSON) and per-chunk with a sliding
// window (SSE tokenizers split placeholders across chunks).
//
// Conventions identical to rtk/: fail-open, in-place mutation, never throw
// into the request path.
export {
  privacyEnabledFor,
  resolvePrivacySalt,
  createRedactionContext,
  scanText,
  scanBody,
} from "./secretScanner.js";
export {
  restoreText,
  restoreBody,
  createStreamRestorer,
  createChunkRestorer,
} from "./streamRestorer.js";
export { mountPrivacyRedaction } from "./mount.js";
