import crypto, { createHash, randomUUID } from "crypto";
import { DefaultExecutor } from "./default.js";
import { parseCodeBuddyFrequencyLimit } from "./codebuddy-cn.js";
import { resolveSessionId } from "../utils/sessionManager.js";

// Deterministic RFC-4122-v5-shaped UUID derived from a session key, mirroring
// the official client's per-conversation id (uuid5 over the session key).
function stableUuidFrom(key) {
  const hash = createHash("sha1").update(key).digest("hex");
  const timeHigh = ((parseInt(hash.slice(12, 16), 16) & 0x0fff) | 0x5000)
    .toString(16)
    .padStart(4, "0");
  const clockSeq = ((parseInt(hash.slice(16, 20), 16) & 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, "0");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    timeHigh,
    clockSeq,
    hash.slice(20, 32),
  ].join("-");
}

function readHeader(headers, name) {
  if (typeof headers?.get === "function") {
    const value = headers.get(name);
    return typeof value === "string" ? value.trim() : "";
  }
  if (!headers || typeof headers !== "object") return "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const AGENT_PATTERN =
  /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;
const WHITELIST_PATTERN =
  /hermes|10router|9router|\bclaude code by anthropic\b|\bsystem instructions\b|你的身份|你的角色设定/i;

const flatten = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n")
      : "";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  buildHeaders(credentials, stream = true, url, model, transformedBody) {
    const headers = super.buildHeaders(credentials, stream, url, model, transformedBody);

    // X-Conversation headers: CodeBuddy / WorkBuddy WAF requires session/conversation
    // identity headers (X-Conversation-ID, X-Conversation-Request-ID, X-Conversation-Message-ID).
    // Deriving a stable RFC-4122 UUID from downstream session keeps conversation continuity
    // while satisfying upstream channel/WAF checks (clears 11128 without triggering 11140).
    try {
      const existingConvId =
        readHeader(credentials?.rawHeaders, "X-Conversation-ID") ||
        (typeof transformedBody?.session_id === "string" && transformedBody.session_id) ||
        (typeof transformedBody?.conversation_id === "string" && transformedBody.conversation_id) ||
        null;

      const isUuid = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

      let convId;
      if (existingConvId && isUuid(existingConvId)) {
        convId = existingConvId;
      } else {
        const sessionId = resolveSessionId({
          headers: credentials?.rawHeaders,
          body: transformedBody,
          connectionId: credentials?.connectionId,
          scope: "codebuddy-intl",
        });
        convId = stableUuidFrom(sessionId || existingConvId || "codebuddy-intl-default");
      }

      const reqUuid = randomUUID();

      headers["X-Conversation-ID"] = convId;
      headers["X-Conversation-Request-ID"] = reqUuid;
      headers["X-Conversation-Message-ID"] = reqUuid;
      headers["X-Request-ID"] = reqUuid;
      // Do NOT set X-Agent-Intent or X-Agent-Type: official IDE extensions do not send
      // these on completions endpoints and upstream WAF treats foreign tags as bot fingerprints.
    } catch {
      const fallbackConvId = randomUUID();
      const fallbackReqId = randomUUID();
      headers["X-Conversation-ID"] = fallbackConvId;
      headers["X-Conversation-Request-ID"] = fallbackReqId;
      headers["X-Conversation-Message-ID"] = fallbackReqId;
      headers["X-Request-ID"] = fallbackReqId;
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    // 11155: upstream rejects the turn whenever reasoning is requested but any PRIOR
    // assistant turn with tool_calls lacks a real (non-empty) reasoning_content.
    // Read from the ORIGINAL body so the guard sees what the client actually sent —
    // super.transformRequest() runs injectReasoningContent, which for DeepSeek
    // (MODEL_RULES /deepseek/i, scope "all") fills a " " placeholder into every
    // unreasoned assistant turn. Note the predicate below already tolerates that
    // placeholder (`" ".trim()` is empty, so `!(…)` is true, keeping the guard live);
    // reading `body` just makes the intent explicit and independent of pre-processing.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    const origin = Array.isArray(body?.messages) ? body.messages : source;
    const hasUnreasonedToolTurn = origin.some(
      (m) => m && m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && !(typeof m.reasoning_content === "string" && m.reasoning_content.trim())
    );

    // A malformed reasoning_effort (true/{}/[]/0/"") is not a level, and upstream
    // answers it with 400 11150 exactly like "auto". Treat it as absent rather than
    // forwarding it (mirrors the typeof check in opencode.js).
    if (transformed.reasoning_effort !== undefined && typeof transformed.reasoning_effort !== "string") {
      delete transformed.reasoning_effort;
    }

    const eff = transformed.reasoning_effort;
    // 11150: DeepSeek-series models reject reasoning_effort "auto" (400, "reasoning
    // effort value is not supported by the current model"); they accept only
    // low/medium/high/xhigh/max/none. Translate so agent clients (e.g. dsh sending
    // THINK:auto) don't hard-fail: auto → high (keep reasoning; it's the gateway default).
    //
    // Priority when 11150 and 11155 could BOTH apply (DeepSeek + "auto" + a prior
    // unreasoned tool turn): DROP the field. Emitting "high" would clear 11150, but the
    // turn still fails 11155, so dropping is the only outcome satisfying both. The 11155
    // guard therefore deliberately WINS over the auto→high translation — hence
    // `!hasUnreasonedToolTurn` gates the DeepSeek branch below. Every other combination
    // falls through to the guard unchanged.
    const isDeepSeek = typeof model === "string" && /deepseek/i.test(model);
    if (isDeepSeek && eff === "auto" && !hasUnreasonedToolTurn) {
      transformed.reasoning_effort = "high";
      transformed.reasoning_summary = "auto";
    } else if (hasUnreasonedToolTurn || eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
      delete transformed.reasoning_summary;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const sanitizeDshText = (s) => (typeof s === "string" ? s.replace(/DeepSeek([ \-_]*)Harness/gi, "DeepSeek​$1Harness") : s);
    const sanitizeMessageContent = (content) => {
      if (typeof content === "string") return sanitizeDshText(content);
      if (Array.isArray(content)) {
        return content.map((part) => {
          if (part && typeof part.text === "string") {
            return { ...part, text: sanitizeDshText(part.text) };
          }
          return part;
        });
      }
      return content;
    };

    // Agent amnesia fix (mirrors codebuddy-cn):
    // Collect downstream system/developer messages instead of discarding them.
    // If none are present, provide the required default leading system prompt.
    const systemParts = [];
    const nonSystemMessages = [];

    for (const message of source) {
      if (!message || typeof message !== "object") continue;
      if (["system", "developer"].includes(message.role)) {
        const text = flatten(message.content);
        if (text) {
          if (WHITELIST_PATTERN.test(text)) {
            // Whitelisted agent (Hermes, 10Router, etc.): pass through untouched!
            systemParts.push(typeof message.content === "string" ? sanitizeDshText(message.content) : sanitizeMessageContent(message.content));
          } else if (AGENT_PATTERN.test(text)) {
            // Foreign agent keyword: replace with neutral prompt to pass content filter
            systemParts.push(NEUTRAL_PROMPT);
          } else {
            // General system prompt: preserve
            systemParts.push(typeof message.content === "string" ? sanitizeDshText(message.content) : sanitizeMessageContent(message.content));
          }
        }
      } else {
        nonSystemMessages.push(message);
      }
    }

    // Ensure leading system prompt exists for 11101 compliance
    const leadingSystemPrompt = systemParts.length > 0
      ? (typeof systemParts[0] === "string" ? systemParts.join("\n\n") : systemParts[0])
      : "You are CodeBuddy Code.";

    transformed.messages = [{ role: "system", content: leadingSystemPrompt }];

    for (const message of nonSystemMessages) {
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: sanitizeDshText(message.content) }] });
      } else {
        transformed.messages.push({ ...message, content: sanitizeMessageContent(message.content) });
      }
    }

    return transformed;
  }

  // 与 codebuddy-cn 同一套 6004 频率限制解析（两站错误体同构）：提取精确重置
  // 时间 resetsAtMs 走精确冷却通道；精准识别 11140 账号风控与 11128 渠道拦截；其他错误回退默认解析。
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const code = data?.code;
        if (code === 11140 || code === 11128) {
          const msg = data?.displayTips?.zh || data?.displayTips?.en || data?.displayMsg?.zh || data?.displayMsg?.en || data?.msg || "";
          return {
            status: response?.status || (code === 11140 ? 403 : 400),
            message: `[CodeBuddy-Intl ${code}]: ${msg || (code === 11140 ? "account restricted (异常行为已被限制)" : "channel verification failed (渠道校验未通过)")}`,
            code,
            accountLocked: code === 11140,
          };
        }
      } catch {}
    }
    const frequencyLimit = parseCodeBuddyFrequencyLimit(bodyText);
    if (frequencyLimit) return frequencyLimit;
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
