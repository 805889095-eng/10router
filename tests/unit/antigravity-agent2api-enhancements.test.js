/**
 * Antigravity 针对 Agent2API 调研的优化项专项测试：
 * 1. 企业账号（非 gmail/googlemail）外壳 userAgent 转为 "jetski"；
 * 2. 多轮对话中，客户端回传的 thought_signature（包括 extra_content.google.thought_signature）优先回填。
 */
import { describe, expect, it } from "vitest";
import { resolveAntigravityUserAgent } from "../../open-sse/providers/shared.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("resolveAntigravityUserAgent", () => {
  it("个人账号 (@gmail.com / @googlemail.com) 以及无邮箱返回 antigravity", () => {
    expect(resolveAntigravityUserAgent("alice@gmail.com")).toBe("antigravity");
    expect(resolveAntigravityUserAgent("bob@googlemail.com")).toBe("antigravity");
    expect(resolveAntigravityUserAgent("ALICE@GMAIL.COM")).toBe("antigravity");
    expect(resolveAntigravityUserAgent("")).toBe("antigravity");
    expect(resolveAntigravityUserAgent(null)).toBe("antigravity");
    expect(resolveAntigravityUserAgent(undefined)).toBe("antigravity");
  });

  it("企业 / Workspace 账号（自定义域名）返回 jetski", () => {
    expect(resolveAntigravityUserAgent("engineer@deepmind.com")).toBe("jetski");
    expect(resolveAntigravityUserAgent("team@company.org")).toBe("jetski");
    expect(resolveAntigravityUserAgent("user@mycorp.cn")).toBe("jetski");
  });
});

describe("Antigravity 外壳 userAgent 动态自适应", () => {
  const executor = new AntigravityExecutor();

  it("企业邮箱在 executor.transformRequest 中外壳 userAgent 设置为 jetski", () => {
    const transformed = executor.transformRequest(
      "gemini-3-flash",
      {
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "hello" }],
      },
      false,
      { email: "dev@mycompany.ai", projectId: "test-proj-123" }
    );
    expect(transformed.userAgent).toBe("jetski");
    expect(transformed.project).toBe("test-proj-123");
  });

  it("个人 gmail 邮箱在 executor.transformRequest 中外壳 userAgent 保持 antigravity", () => {
    const transformed = executor.transformRequest(
      "gemini-3-flash",
      {
        model: "gemini-3-flash",
        messages: [{ role: "user", content: "hello" }],
      },
      false,
      { email: "user@gmail.com", projectId: "test-proj-123" }
    );
    expect(transformed.userAgent).toBe("antigravity");
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
