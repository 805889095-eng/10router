import { describe, it, expect } from "vitest";
import { isOversizedForCbcn, describeCbcnOversize, describeCbcnOversizeHint, CBCN_PAYLOAD_LIMITS } from "../../open-sse/executors/codebuddy-cn.js";
import { compressMessages } from "../../open-sse/rtk/index.js";
import { buildErrorBody, unavailableResponse } from "../../open-sse/utils/error.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("CodeBuddy CN oversized payload pre-check", () => {
  it("detects payload with too many messages", () => {
    const normal = { messages: Array.from({ length: 100 }, () => ({ role: "user", content: "hi" })) };
    expect(isOversizedForCbcn(normal)).toBe(false);

    const oversized = { messages: Array.from({ length: CBCN_PAYLOAD_LIMITS.maxMessages + 10 }, () => ({ role: "user", content: "hi" })) };
    expect(isOversizedForCbcn(oversized)).toBe(true);
  });

  it("lets long conversations through up to maxMessages (5000 条不再被拦)", () => {
    // 消息数 2048 → 5000（2026-10-21）：每轮「assistant 工具调用 + tool 结果」各记
    // 两条，挂 MCP 的真实会话很容易撞到 2048；这一维与 11128 无因果，不该先于体积触发。
    expect(CBCN_PAYLOAD_LIMITS.maxMessages).toBe(5000);
    const fill = (n) => ({ messages: Array.from({ length: n }, () => ({ role: "user", content: "hi" })) });
    expect(isOversizedForCbcn(fill(2048))).toBe(false);
    expect(isOversizedForCbcn(fill(5000))).toBe(false);
    expect(isOversizedForCbcn(fill(5001))).toBe(true);
  });

  it("does NOT reject tool-heavy-but-small bodies (2026-10-03 回归)", () => {
    // 工具数从未与体积分离验证过(09-17 的 11128 样本是 4.5MB/1676 条/54 工具整体
    // 失败);真实 Claude Code/codex 会话挂 MCP 工具集轻松过 60 个工具、体积适中,
    // 旧的一刀切把 cbcn 从这两类客户端里整个锁死。工具数只进诊断信息。
    const toolHeavy = {
      messages: Array.from({ length: 50 }, () => ({ role: "user", content: "hi" })),
      tools: Array.from({ length: 140 }, (_, i) => ({ type: "function", function: { name: `tool_${i}` } })),
    };
    expect(isOversizedForCbcn(toolHeavy)).toBe(false);
    // 诊断信息仍报告工具数,供后续上游行为校准。
    expect(describeCbcnOversize(toolHeavy)).toContain("140 个工具");
  });

  it("detects payload exceeding byte size threshold", () => {
    // 守卫线 32MB（2026-10-18 由 3.2MB 放宽：体积与 11128 无因果，低阈值只会误伤真实会话）
    const bigContent = "a".repeat(33 * 1024 * 1024);
    const oversized = { messages: [{ role: "user", content: bigContent }] };
    expect(isOversizedForCbcn(oversized)).toBe(true);
    expect(describeCbcnOversize(oversized)).toContain("33.00MB > 32.0MB");
  });

  it("lets real long sessions through (4.5MB and 20MB are both under the guard)", () => {
    // 09-17 的 11128 样本体积正好是 4.5MB；20MB 则是比任何观测到的真实会话都大的
    // 压力值——两者都必须放行，交给上游判定。
    for (const mb of [4.5, 20]) {
      const body = { messages: [{ role: "user", content: "a".repeat(mb * 1024 * 1024) }] };
      expect(isOversizedForCbcn(body)).toBe(false);
    }
  });

  it("handles null or non-object body safely", () => {
    expect(isOversizedForCbcn(null)).toBe(false);
    expect(isOversizedForCbcn(undefined)).toBe(false);
    expect(isOversizedForCbcn("string")).toBe(false);
  });

  // The guard now runs AFTER RTK compression (open-sse/handlers/chatCore.js),
  // so the body it sees is the compressed one. These two cases pin down the
  // behaviour that made the move worthwhile: a tool_result-heavy body that is
  // over the limit as-sent, but under it once RTK has trimmed the tool output.
  it("a multi-tool_result body shrinks below the 32MB guard after RTK compression", () => {
    // This is the case the guard move actually buys us, and the reason a plain
    // threshold bump is not enough.
    //
    // RAW_CAP (open-sse/rtk/constants.js) is 10MiB: any SINGLE text blob over
    // 10MB is skipped by compressText and left byte-for-byte intact. So one
    // 33MB tool_result is never compressed, and "compress then measure" ==
    // "measure as sent" for it — the threshold alone decides.
    //
    // But compression is PER BLOB. Several 9MB tool_results each sit under the
    // cap, each gets crushed, and the TOTAL drops far below the limit. That body
    // is over 32MB as sent (a threshold-only guard kills it) yet tiny once
    // compressed (the moved guard lets it through).
    //
    // Real-world shape: an agentic session that ran five big log/grep commands.
    const line = "[WARN] retrying fetch after transient network error, attempt in progress";
    const chunk = Array(Math.floor((9 * 1024 * 1024) / (line.length + 1))).fill(line).join("\n");
    const messages = [{ role: "user", content: "go" }];
    for (let i = 0; i < 5; i++) {
      messages.push({ role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "f", arguments: "{}" } }] });
      messages.push({ role: "tool", tool_call_id: `c${i}`, content: chunk });
    }
    const body = { messages };

    // Over the 32MB guard line as sent — a threshold-only check rejects here.
    expect(isOversizedForCbcn(body)).toBe(true);

    // RTK crushes each 9MB blob, so what actually leaves the process fits.
    const stats = compressMessages(body, true);
    expect(stats).not.toBeNull();
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
    expect(isOversizedForCbcn(body)).toBe(false);
  });

  it("does NOT compress a single oversized blob, so the guard still fires (RAW_CAP)", () => {
    // Guard against over-trusting compression: RAW_CAP makes a single >10MB
    // blob uncompressed. Pinned so nobody later assumes "RTK always saves us"
    // and drops the threshold back to a value below RAW_CAP.
    const line = "[WARN] retrying fetch after transient network error, attempt in progress";
    const chunk = Array(Math.floor((33 * 1024 * 1024) / (line.length + 1))).fill(line).join("\n");
    const body = { messages: [{ role: "user", content: "go" }, { role: "tool", tool_call_id: "c1", content: chunk }] };

    const stats = compressMessages(body, true);
    expect(stats.bytesAfter).toBe(stats.bytesBefore); // skipped by RAW_CAP
    expect(isOversizedForCbcn(body)).toBe(true);       // so the guard is what saves us
  });

  it("the rejection hint states the actual guard line, not a stale 3.2MB", () => {
    // The hint is user-facing copy. When the threshold moved 3.2MB -> 32MB the
    // literal was left behind, telling users a 32MB guard was a 3.2MB one.
    const oversized = { messages: [{ role: "user", content: "a".repeat(33 * 1024 * 1024) }] };
    const hint = describeCbcnOversizeHint("codebuddy-cn", "m", describeCbcnOversize(oversized), "");
    expect(hint).toContain("32MB");
    expect(hint).not.toContain("3.2MB");
  });

  it("the rejection hint says it was blocked LOCALLY and reports the RTK delta", () => {
    const oversized = { messages: [{ role: "user", content: "a".repeat(3.5 * 1024 * 1024) }] };
    const stats = describeCbcnOversize(oversized);
    const note = "｜RTK 已压缩 3670016→1887436 B，压缩后仍超限";
    const hint = describeCbcnOversizeHint("codebuddy-cn", "deepseek-v4.1-flash", stats, note);

    // Users must be able to tell this apart from a real upstream 11128.
    expect(hint).toContain("本机拦截");
    expect(hint).toContain("请求没有发到上游");
    // The RTK delta explains WHY clearing the session is the only option left.
    expect(hint).toContain("RTK 已压缩");
    // Fallback wiring depends on these two literals (open-sse/config/errorConfig.js).
    expect(hint).toContain("请求体积已达极端量级");
    expect(describeCbcnOversizeHint("codebuddy-cn", "m", stats, "")).toContain("请求体积已达极端量级");
  });
});

describe("Error body shape compatibility", () => {
  it("buildErrorBody includes top-level type: error for Claude / Anthropic client compatibility", () => {
    const body = buildErrorBody(400, "test bad request");
    expect(body.type).toBe("error");
    expect(body.error).toBeDefined();
    expect(body.error.message).toBe("test bad request");
  });

  it("unavailableResponse includes top-level type: error", async () => {
    const res = unavailableResponse(503, "channel blocked", new Date(Date.now() + 60000).toISOString(), "reset after 60s");
    const json = await res.json();
    expect(json.type).toBe("error");
    expect(json.error.message).toContain("channel blocked");
  });

  it("triggers fallback without cooldown on oversized rejection (Issue #65)", () => {
    const errText = "[codebuddy-cn/kimi-k3] 请求体积已达极端量级（33.0MB > 32.0MB），已在本地拦截，避免触发上游渠道级风控。";
    const { shouldFallback, cooldownMs } = checkFallbackError(400, errText, 0, "codebuddy-cn");
    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBe(0);

    const normal400 = checkFallbackError(400, "invalid parameter", 0, "codebuddy-cn");
    expect(normal400.shouldFallback).toBe(false);
  });
});
