import { describe, it, expect } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("CodeBuddy channel verification headers & anti-fingerprint protection", () => {
  it.each([
    ["intl", CodeBuddyIntlExecutor],
    ["cn", CodeBuddyExecutor],
  ])("%s outputs RFC-4122 compliant UUIDs and identity headers", (name, Exec) => {
    const exec = new Exec();
    const headers = exec.buildHeaders(
      { connectionId: "conn-1" },
      true,
      "http://test",
      "deepseek-v4.1-flash",
      { session_id: "sess-abc" }
    );

    expect(headers["X-Conversation-ID"]).toMatch(UUID_RE);
    expect(headers["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(headers["X-Conversation-Message-ID"]).toMatch(UUID_RE);
    expect(headers["X-Request-ID"]).toBe(headers["X-Conversation-Message-ID"]);

    // Agent identity: the real @tencent-ai/codebuddy-code 2.176.0 CLI sets all three
    // on every completions call (extracted from dist/codebuddy-headless.js). Both
    // channels now declare the CLI identity (X-IDE-Type: CLI), so both must send them —
    // omitting them is an identity contradiction the WorkBuddy WAF can fingerprint.
    expect(headers["X-Agent-Intent"]).toBe("craft");
    expect(headers["X-Agent-Runtime"]).toBe("local-agent");
    expect(headers["X-Agent-Type"]).toBe("main");
  });

  it("maintains session continuity with stable conversation ID and unique request IDs", () => {
    const exec = new CodeBuddyIntlExecutor();
    const h1 = exec.buildHeaders(
      { connectionId: "conn-1" },
      true,
      "http://test",
      "deepseek-v4.1-flash",
      { session_id: "sess-xyz" }
    );
    const h2 = exec.buildHeaders(
      { connectionId: "conn-1" },
      true,
      "http://test",
      "deepseek-v4.1-flash",
      { session_id: "sess-xyz" }
    );

    expect(h1["X-Conversation-ID"]).toBe(h2["X-Conversation-ID"]);
    expect(h1["X-Conversation-Request-ID"]).not.toBe(h2["X-Conversation-Request-ID"]);
  });

  it("preserves incoming valid UUID x-conversation-id case-insensitively", () => {
    const exec = new CodeBuddyIntlExecutor();
    const customUuid = "12345678-1234-4234-8234-123456789abc";
    const headers = exec.buildHeaders(
      { rawHeaders: { "x-conversation-id": customUuid } },
      true,
      "http://test",
      "deepseek-v4.1-flash",
      {}
    );

    expect(headers["X-Conversation-ID"]).toBe(customUuid);
  });

  it("classifies 11140 account lock and 11128 channel verification errors", () => {
    const exec = new CodeBuddyIntlExecutor();

    const err11140 = exec.parseError(
      { status: 403 },
      JSON.stringify({
        code: 11140,
        msg: "request illegal",
        displayMsg: { zh: "账号存在异常行为，已被限制使用" },
      })
    );
    expect(err11140.status).toBe(403);
    expect(err11140.code).toBe(11140);
    expect(err11140.accountLocked).toBe(true);
    expect(err11140.message).toContain("11140");

    const err11128 = exec.parseError(
      { status: 400 },
      JSON.stringify({
        code: 11128,
        msg: "conversation id missing",
      })
    );
    expect(err11128.status).toBe(400);
    expect(err11128.code).toBe(11128);
    expect(err11128.message).toContain("11128");
  });
});
