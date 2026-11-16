// CodeBuddy CLI identity — single source of truth for the fingerprint the CN and
// Intl channels present upstream.
//
// Why a shared module: the version used to be hardcoded in six places across two
// registries and two executors, so every upstream release meant six edits and one
// of them always got missed. A stale UA is itself a bot fingerprint (2.108.1 was
// once 68 releases behind).
//
// Verified against `@tencent-ai/codebuddy-code` 2.183.0 — the shipped bundle at
// dist/codebuddy-headless.js. Notes from that extraction:
//   - The official 2.x CLI does NOT emit a literal `CLI/x.y.z CodeBuddy/x.y.z`
//     User-Agent. It builds one dynamically (CLI/TUI/IDE tokens are present in the
//     bundle) and derives X-IDE-Type/Name/Version from clientInfoProvider, whose
//     ideVersion defaults to "0.0.0" when nothing injects it.
//   - What we send is therefore a *reconstructed* identity, not a byte-exact copy.
//     It has not tripped detection, and it is strictly closer to a real client than
//     the old IDE-plugin identity (which claimed X-IDE-Type: IDE with a CLI-series
//     version — a pair no real client can produce).
//   - Keep the header SET in sync when bumping. 2.184.0 is NOT a version-only
//     release: it adds the attribution pair X-Agent-Core: "agent-cli" and
//     X-Feature-Module (empty when no feature module) to every model call, so the
//     header set moved and the executors must mirror it.
//   - `x-codebuddy-request: 1` must stay absent: the CLI only emits it on its LOCAL
//     daemon endpoints, so forwarding it upstream marks the request as non-official.
export const CODEBUDDY_CLI_VERSION = "2.184.0";

/**
 * Attribution headers the CLI attaches to every model call since 2.184.0.
 * Values captured from a live 2.184.0 CLI run against a mock upstream
 * (CODEBUDDY_BASE_URL + fake token) — the real request carried:
 *   X-Agent-Core: agent-cli        (hardcoded literal in the bundle)
 *   X-Feature-Module: cli_local    (resolveFeatureModule: ideType AND ideName are
 *                                   "cli" → "cli_local"; the `?? ""` fallback only
 *                                   fires for NON-CLI identities, so an empty value
 *                                   is itself a mismatch for a CLI-identity client)
 *   X-Agent-Runtime: other         (normalizeAgentRuntime returns "other" for
 *                                   anything outside AGENT_RUNTIMES; nothing in the
 *                                   bundle ever writes "local-agent" — that value
 *                                   only arrives from host baggage / session meta /
 *                                   CODEBUDDY_AGENT_RUNTIME env)
 * Sending a value the real client never produces is worse than a version drift:
 * it is a positive contradiction, not an absence.
 */
export const CODEBUDDY_AGENT_CORE = "agent-cli";
export const CODEBUDDY_FEATURE_MODULE = "cli_local";
export const CODEBUDDY_AGENT_RUNTIME = "other";

/** The UA both channels send. */
export const CODEBUDDY_USER_AGENT = `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`;

/**
 * Identity headers shared by the CN and Intl transports. Callers spread this into
 * their own `headers` so channel-specific additions stay local.
 */
export function codebuddyIdentityHeaders() {
  return {
    "User-Agent": CODEBUDDY_USER_AGENT,
    "X-Product": "SaaS",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "X-IDE-Version": CODEBUDDY_CLI_VERSION,
    "Content-Type": "application/json;charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
  };
}
