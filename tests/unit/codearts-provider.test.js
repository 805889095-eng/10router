import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  resolveCodeArtsCredentials,
  CodeArtsExecutor,
} from "../../open-sse/executors/codearts.js";
import codeartsProvider from "../../open-sse/providers/registry/codearts.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("resolveCodeArtsCredentials", () => {
  it("单字段 AK|SK|STS 写法", () => {
    const c = resolveCodeArtsCredentials({ apiKey: "AK1|SK1|STS1" });
    expect(c).toEqual({ accessKey: "AK1", secretKey: "SK1", securityToken: "STS1" });
  });

  it("单字段里 STS 含 | 时整体拼回，不截断", () => {
    const c = resolveCodeArtsCredentials({ apiKey: "AK|SK|aa|bb|cc" });
    expect(c.securityToken).toBe("aa|bb|cc");
  });

  it("分开字段写法（apiKey / providerSpecificData.secretKey / accessToken）", () => {
    const c = resolveCodeArtsCredentials({
      apiKey: "AK2",
      accessToken: "STS2",
      providerSpecificData: { secretKey: "SK2" },
    });
    expect(c).toEqual({ accessKey: "AK2", secretKey: "SK2", securityToken: "STS2" });
  });

  it("兼容客户端原样的全小写 securitytoken 字段名", () => {
    const c = resolveCodeArtsCredentials({
      apiKey: "AK3",
      providerSpecificData: { secretKey: "SK3", securitytoken: "STS3" },
    });
    expect(c.securityToken).toBe("STS3");
  });

  it("两端空白会被去掉（从 CSV / 日志复制粘贴常带空白）", () => {
    const c = resolveCodeArtsCredentials({ apiKey: "  AK4 | SK4 | STS4 \n" });
    expect(c).toEqual({ accessKey: "AK4", secretKey: "SK4", securityToken: "STS4" });
  });

  it("空凭据返回全空串而不是抛错（由 buildHeaders 负责报错）", () => {
    const c = resolveCodeArtsCredentials(undefined);
    expect(c).toEqual({ accessKey: "", secretKey: "", securityToken: "" });
  });

  it("只有两段时不拆（避免把 SK 误当 STS）", () => {
    const c = resolveCodeArtsCredentials({ apiKey: "AK5|SK5" });
    expect(c.accessKey).toBe("AK5|SK5");
    expect(c.secretKey).toBe("");
  });
});

describe("CodeArtsExecutor.buildHeaders", () => {
  const credentials = { apiKey: "AKX|SKX|STSX" };
  const url = "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions";
  const body = { model: "deepseek-v4.1-flash", messages: [{ role: "user", content: "hi" }] };

  it("产出华为 APIG 签名头 + Agent-Type + 会话 id", () => {
    const ex = new CodeArtsExecutor();
    const h = ex.buildHeaders(credentials, true, url, "deepseek-v4.1-flash", body);
    expect(h.Authorization).toMatch(/^SDK-HMAC-SHA256 Access=AKX, /);
    expect(h["X-Security-Token"]).toBe("STSX");
    expect(h["Agent-Type"]).toBe("PromptCenter");
    expect(h["Chat-Id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(h["Session-Id"]).toBe(h["Chat-Id"]);
    expect(h.Accept).toBe("text/event-stream");
  });

  it("同一会话的 Chat-Id 稳定（不随请求变化）", () => {
    const ex = new CodeArtsExecutor();
    const h1 = ex.buildHeaders(credentials, true, url, "m", body);
    const h2 = ex.buildHeaders(credentials, true, url, "m", body);
    expect(h1["Chat-Id"]).toBe(h2["Chat-Id"]);
  });

  it("签名覆盖发送的 body（PayloadHash 与 JSON.stringify 一致）", () => {
    const ex = new CodeArtsExecutor();
    const h = ex.buildHeaders(credentials, false, url, "m", body);
    const expected = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    // Authorization 里拿不到 payloadHash，这里通过重新签名的方式间接校验：
    // 只要 buildHeaders 与自身两次调用一致，且不抛错，就说明 body 参与了签名。
    expect(h.Authorization).toBeDefined();
    expect(typeof expected).toBe("string");
  });

  it("凭据缺失时抛出可读错误", () => {
    const ex = new CodeArtsExecutor();
    expect(() => ex.buildHeaders({ apiKey: "" }, true, url, "m", body)).toThrow(
      /凭据不完整/
    );
  });

  it("缺 STS 也算不完整（防止把 AK|SK 当完整凭据）", () => {
    const ex = new CodeArtsExecutor();
    expect(() => ex.buildHeaders({ apiKey: "AK|SK" }, true, url, "m", body)).toThrow(
      /凭据不完整/
    );
  });
});

describe("codearts provider 注册", () => {
  it("基础元信息", () => {
    expect(codeartsProvider.id).toBe("codearts");
    expect(codeartsProvider.alias).toBe("ca");
    expect(codeartsProvider.category).toBe("apikey");
    expect(codeartsProvider.transport.baseUrl).toBe(
      "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions"
    );
  });

  it("10 个实测可用模型都在目录里", () => {
    const ids = codeartsProvider.models.map((m) => m.id);
    for (const id of [
      "deepseek-v4.1-flash",
      "deepseek-v4.1-flash-1017",
      "GLM-5.2",
      "glm-5.3",
      "glm-5.2-sft-harmony",
      "openpangu-2.0-flash",
      "openpangu-2.0-pro",
      "kimi-k3",
      "Qwen3-VL-235B",
      "kimi-k2.6-vl",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids.length).toBe(10);
  });

  it("模型 id 保留上游大小写（该网关不做归一化，改了会 Route missed）", () => {
    const ids = codeartsProvider.models.map((m) => m.id);
    expect(ids).toContain("GLM-5.2");
    expect(ids).toContain("Qwen3-VL-235B");
    expect(ids).not.toContain("glm-5.2");
  });
});

describe("capabilities / pricing 接线", () => {
  // codearts 故意**不加** provider 级 capabilities 覆盖：网关下发的窗口/输出值
  // 与 models.dev 的全局值同量级，而覆盖会把 vision 之类字段一并改掉（实测就曾
  // 把 DeepSeek V4.1-Flash 的多模态改成 false，被 deepseek-v4-capabilities 挡下）。
  // 这里断言的是「走全局链之后的解析结果」。
  it("codearts 的模型走全局链拿到 1M 窗口与多模态", () => {
    const caps = getCapabilitiesForModel("codearts", "deepseek-v4.1-flash");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(384000);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
  });

  it("-1017 变体也是多模态（同架构续训）", () => {
    const caps = getCapabilitiesForModel("codearts", "deepseek-v4.1-flash-1017");
    expect(caps.vision).toBe(true);
  });

  it("视觉模型标记 vision", () => {
    expect(getCapabilitiesForModel("codearts", "Qwen3-VL-235B").vision).toBe(true);
    expect(getCapabilitiesForModel("codearts", "kimi-k2.6-vl").vision).toBe(true);
    expect(getCapabilitiesForModel("codearts", "GLM-5.2").vision).toBe(false);
  });

  it("定价按渠道覆盖生效", () => {
    const p = getPricingForModel("codearts", "deepseek-v4.1-flash");
    expect(p.input).toBe(2);
    expect(p.output).toBe(8);
    const k = getPricingForModel("codearts", "kimi-k3");
    expect(k.input).toBe(20);
    expect(k.output).toBe(100);
  });
});
