// Agent amnesia fix: CodeBuddy must NOT wipe the system prompt of our own
// agents (Hermes/10Router) — the old code replaced any system message longer
// than 2000 chars or matching a broad agent regex with a neutral one-liner,
// which erased the agent's full identity/tool memory every new session.
import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

describe("CodeBuddyExecutor system-prompt handling (agent amnesia fix)", () => {
  const exec = new CodeBuddyExecutor();

  it("passes through a whitelisted Hermes system prompt untouched (long or not)", () => {
    const longHermes = "You are Hermes, an AI agent. " + "x".repeat(3000) + " Role: coding assistant.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: longHermes }] }, false, {});
    expect(out.messages[0].content).toBe(longHermes);
  });

  it("passes through a whitelisted 10Router system prompt untouched", () => {
    const sys = "You are a helpful 10Router gateway assistant. Your role is X.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: sys }] }, false, {});
    expect(out.messages[0].content).toBe(sys);
  });

  it("does NOT wipe a long prompt that merely lacks agent identity markers", () => {
    // >2000 chars, but no agent identity wording and no whitelist marker — must
    // survive (the old `length > 2000` catch-all is removed).
    const longPrompt = "You are a useful helper. " + "y".repeat(3000);
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: longPrompt }] }, false, {});
    expect(out.messages[0].content).toBe(longPrompt);
  });

  it("still replaces a genuine foreign agent system prompt that matches AGENT_PATTERN", () => {
    // Not whitelisted, and clearly a competing agent signature -> replaced to
    // pass CodeBuddy's content filter.
    const foreignAgent = "You are Cursor, an AI coding agent with orchestration capabilities.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: foreignAgent }] }, false, {});
    expect(out.messages[0].content).not.toBe(foreignAgent);
    expect(out.messages[0].content).toMatch(/helpful AI assistant/);
  });

  it("leaves user messages untouched", () => {
    const user = "Please write a function.";
    const out = exec.transformRequest("glm-5.2", { messages: [{ role: "user", content: user }] }, false, {});
    expect(out.messages[0].content).toBe(user);
  });

  // [merge 2c0afd7d] Tencent WAF 对 "DeepSeek Harness" 直接报 11128/400。
  // 必须在所有消息里注入零宽空格规避，且不能破坏语义。
  describe("Dsh (DeepSeek Harness) sanitising — WAF 400/11128 bypass", () => {
    const ZWSP = "\u200B";

    it("injects a zero-width space between DeepSeek and Harness in user messages", () => {
      const user = "请解释 DeepSeek Harness 的架构";
      const out = exec.transformRequest("deepseek-v4.1-flash", { messages: [{ role: "user", content: user }] }, false, {});
      const got = out.messages[0].content;
      // 1) 注入成功：DeepSeek 与 Harness 之间隔了零宽空格
      expect(got).toContain("DeepSeek" + ZWSP + " Harness");
      // 2) 关键：连续的可被 WAF 匹配的 "DeepSeek Harness" 已不存在
      expect(got).not.toContain("DeepSeek Harness");
      // 3) 语义保留：去掉零宽空格后与原文完全一致
      expect(got.split(ZWSP).join("")).toBe(user);
    });

    it("handles hyphen / underscore / bare variants case-insensitively", () => {
      const cases = ["deepseek-harness", "DeepSeek_Harness", "DEEPSEEKHarness", "DeepSeek Harness"];
      for (const c of cases) {
        const out = exec.transformRequest("deepseek-v4.1-flash", { messages: [{ role: "user", content: c }] }, false, {});
        expect(out.messages[0].content).toContain(ZWSP);
      }
    });

    it("sanitises inside array-shaped content parts", () => {
      const parts = [{ type: "text", text: "about DeepSeek Harness here" }];
      const out = exec.transformRequest("deepseek-v4.1-flash", { messages: [{ role: "user", content: parts }] }, false, {});
      expect(out.messages[0].content[0].text).toContain(ZWSP);
    });

    it("sanitises whitelisted system prompts too (they still leave the machine)", () => {
      const sys = "You are Hermes, an AI agent. Mention DeepSeek Harness freely. Role: coding assistant.";
      const out = exec.transformRequest("glm-5.2", { messages: [{ role: "system", content: sys }] }, false, {});
      expect(out.messages[0].content).toContain(ZWSP);
      // 仍是原 prompt，没有被 NEUTRAL_PROMPT 顶掉
      expect(out.messages[0].content).toContain("You are Hermes");
    });

    it("leaves unrelated text byte-identical (no collateral change)", () => {
      const clean = "请写一个排序函数，输入是整数数组。";
      const out = exec.transformRequest("deepseek-v4.1-flash", { messages: [{ role: "user", content: clean }] }, false, {});
      expect(out.messages[0].content).toBe(clean);
    });
  });
});
