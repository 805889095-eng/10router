/**
 * Antigravity 针对 Agent2API 调研的优化项专项测试：
 * 1. thought_signature 双向闭环（保留）；
 * 2. userAgent 回归守护：外壳必须固定发 "antigravity"，
 *    第三方邮箱（qq/163 等）注册的个人 Google 账号**不得**被判成企业号 jetski。
 */
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_USER_AGENT_TAG } from "../../open-sse/providers/shared.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("Antigravity 外壳 userAgent 回归守护", () => {
  const executor = new AntigravityExecutor();

  it("常量固定为 antigravity", () => {
    expect(ANTIGRAVITY_USER_AGENT_TAG).toBe("antigravity");
  });

  // v1.8.8 事故：QQ 邮箱被误判 jetski → 400 User location is not supported。
  // 任何第三方邮箱 / 企业域邮箱都不得改变这个值。
  it.each([
    ["805889095@qq.com"],
    ["someone@gmail.com"],
    ["bob@googlemail.com"],
    ["engineer@deepmind.com"],
    ["team@company.org"],
    ["user@mycorp.cn"],
    [""],
  ])("账号 %s 的外壳 userAgent 一律为 antigravity", (email) => {
    const transformed = executor.transformRequest(
      "gemini-3-flash",
      { model: "gemini-3-flash", messages: [{ role: "user", content: "hello" }] },
      false,
      { email, projectId: "test-proj-123" },
    );
    expect(transformed.userAgent).toBe("antigravity");
  });

  it("QQ 邮箱账号在信封组装路径上同样不发 jetski", () => {
    const request = {
      model: "gemini-3-flash",
      messages: [{ role: "user", content: "hello" }],
    };
    const translated = translateRequest(
      "openai", "antigravity", "gemini-3-flash", request, false,
      { email: "805889095@qq.com", projectId: "p1" },
    );
    const envelope = translated.request ? translated : translated;
    expect(JSON.stringify(envelope)).not.toContain("jetski");
  });
});

describe("客户端回传 thought_signature 闭环", () => {
  it("geminiToOpenAIResponse 会在 tool_calls 中下发 extra_content.google.thought_signature", () => {
    const chunk = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: "search_db", args: { q: "test" } },
                thoughtSignature: "sig_from_gemini_server_abc123",
              },
            ],
          },
        },
      ],
    };
    const state = { functionIndex: 0, messageId: "msg_1", model: "gemini-3-flash" };
    const res = geminiToOpenAIResponse(chunk, state);
    expect(res).toBeTruthy();
    const toolCall = res[0].choices[0].delta.tool_calls[0];
    expect(toolCall.function.name).toBe("search_db");
    expect(toolCall.extra_content?.google?.thought_signature).toBe("sig_from_gemini_server_abc123");
  });

  it("客户端在历史中回传 extra_content.google.thought_signature 时优先采用该真签名", () => {
    const request = {
      model: "gemini-3-flash",
      messages: [
        { role: "user", content: "query" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_client_999",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"/tmp/a"}' },
              extra_content: {
                google: {
                  thought_signature: "custom_client_exact_signature_xyz",
                },
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_client_999", content: "file content" },
      ],
    };

    const translated = translateRequest("openai", "gemini", "gemini-3-flash", request);
    const modelTurn = translated.contents.find((c) => c.role === "model");
    expect(modelTurn).toBeDefined();
    const fcPart = modelTurn.parts.find((p) => p.functionCall);
    expect(fcPart).toBeDefined();
    expect(fcPart.thoughtSignature).toBe("custom_client_exact_signature_xyz");
  });

  it("多并行工具调用中仅首个保留签名，兄弟调用不带签名（符合 Gemini 规则）", () => {
    const request = {
      model: "gemini-3-flash",
      messages: [
        { role: "user", content: "query" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "tool1", arguments: "{}" },
              thought_signature: "sig_first_call",
            },
            {
              id: "call_2",
              type: "function",
              function: { name: "tool2", arguments: "{}" },
              thought_signature: "sig_second_call",
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "res1" },
        { role: "tool", tool_call_id: "call_2", content: "res2" },
      ],
    };

    const translated = translateRequest("openai", "gemini", "gemini-3-flash", request);
    const modelTurn = translated.contents.find((c) => c.role === "model");
    const fcParts = modelTurn.parts.filter((p) => p.functionCall);
    expect(fcParts).toHaveLength(2);
    expect(fcParts[0].thoughtSignature).toBe("sig_first_call");
    expect(fcParts[1].thoughtSignature).toBeUndefined();
  });
});
