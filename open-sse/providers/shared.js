import { platform, arch } from "os";

// === OS/Arch helpers (Stainless fingerprint) ===
export function mapStainlessOs() {
  switch (platform()) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform()}`;
  }
}

export function mapStainlessArch() {
  switch (arch()) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${arch()}`;
  }
}

// Anthropic API version (single source — reused across claude-format providers/executors)
export const ANTHROPIC_API_VERSION = "2023-06-01";

// Shared Claude-compatible API headers (reused across claude-format providers)
export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Claude CLI version reported by the spoofed fingerprint. Bumped in lockstep with
// what upstream Claude Code ships — Opus 5.5 gateways reject older versions.
export const CLAUDE_CLI_VERSION = "2.1.280";

// Full Claude CLI fingerprint — required by providers that gate on client identity (e.g. agentrouter)
export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": `claude-cli/${CLAUDE_CLI_VERSION} (external, sdk-cli)`,
  "X-App": "cli",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v24.14.0",
  "X-Stainless-Package-Version": "0.80.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapStainlessArch(),
  "X-Stainless-Os": mapStainlessOs(),
  "X-Stainless-Timeout": "600"
};

const ANTHROPIC_BETA_BASE = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
];
const ANTHROPIC_BETA_HEAVY_AGENT = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];

const ANTHROPIC_BETA_REDACT_THINKING = "redact-thinking-2026-02-12";

// `redact-thinking` asks Anthropic to return signature-only thinking blocks —
// right for clients that never render thinking, but it blanks the summaries a
// client explicitly requested with thinking.display: "summarized".
export function wantsThinkingSummaries(body) {
  return body?.thinking?.display === "summarized";
}

// Heavy-agent beta flags are gated to opus/sonnet — cheaper models don't need them.
export function selectAnthropicBeta(model = "", body = null) {
  const flags = ANTHROPIC_BETA_BASE.filter(
    (flag) => flag !== ANTHROPIC_BETA_REDACT_THINKING || !wantsThinkingSummaries(body),
  );
  if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
  return flags.join(",");
}

// 合并多来源的 anthropic-beta 旗标（去重、保序）：上游计算值 + 客户端自带的
// beta 头。客户端显式要求的 beta 特性（如 context-management）必须存活。
export function mergeAnthropicBeta(...values) {
  const flags = values.flatMap((v) => (typeof v === "string" ? v.split(",") : [])).map((f) => f.trim()).filter(Boolean);
  return [...new Set(flags)].join(",");
}

// Shared baseUrls
export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";

// Default base for dynamic compat providers (openai-compatible-* / anthropic-compatible-*) when user gives no baseUrl
export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthropic.com/v1";

// Official Antigravity Hub Desktop 2.24.0 fingerprint captured from macOS arm64.
// Product line renamed IDE → Hub at 2.24.0, so the UA path segment changes too.
// Keep this static even when 10Router runs on Linux: the provider profile is
// intentionally matching the Hub client, not the server host.
//
// Measured 2026-11-03 against a live account, replaying the identical envelope:
//   gemini-3.8-flash-medium → 200
//   gemini-4-argon-{low,medium,high}, bare `gemini-4-argon` → 404
//   "Requested entity was not found"
// under every fingerprint tried (ide/2.22.0, ide/2.24.0, hub/2.24.0, hub/2.25.0).
// So the argon 404 is the ACCOUNT lacking the model entitlement, not the client
// version — upgrading this constant does not grant argon access. The registry
// still lists the argon tiers for accounts that do have it.
export const ANTIGRAVITY_IDE_VERSION = "2.24.0";
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/hub/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;

/**
 * Antigravity envelope `userAgent` tag.
 *
 * 固定发 "antigravity"。**不要**按邮箱域名推断企业身份。
 *
 * 踩过的坑（v1.8.8 回滚原因，2026-11-04）：曾照抄 Agent2API 的
 * 「非 gmail/googlemail → jetski」规则，结果 NAS 上 `805889095@qq.com`
 * 这类**第三方邮箱注册的个人 Google 账号**被误判成企业号，外壳带上
 * `"userAgent": "jetski"` 后大量请求返回
 * `400 User location is not supported for the API use.`（FAILED_PRECONDITION）——
 * jetski 走企业后端，企业后端的地区策略更严，同一账号时好时坏。
 * 回滚到固定 "antigravity" 后报错消失。
 *
 * 真要识别 Workspace 只能靠 id_token 的 `hd` claim（OAuth 登录时才有），
 * 不能用邮箱域名猜；当前没有可靠来源，故此处不实现。
 */
export const ANTIGRAVITY_USER_AGENT_TAG = "antigravity";

// Antigravity OAuth client credentials (public CLI client — duplicated in usage.js + src/lib/oauth)
export const ANTIGRAVITY_OAUTH_CLIENT = {
  clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret: "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"
};

// Gemini (Google) OAuth client credentials (public CLI client — shared by gemini, gemini-cli, src/lib/oauth)
export const GOOGLE_OAUTH_CLIENT = {
  clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
  clientSecret: "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"
};
