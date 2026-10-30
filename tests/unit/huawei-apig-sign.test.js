import { describe, it, expect } from "vitest";
import {
  signRequest,
  signedHeaders,
  canonicalUri,
  canonicalQuery,
  sdkDate,
  huaweiEncode,
  EMPTY_BODY_SHA256,
} from "../../open-sse/shared/huaweiApigSign.js";

/**
 * 期望值来源：同算法的独立 Python 实现，其正确性由华为网关的对照实验证明 ——
 * 改坏 SK → 401 APIG.0301 signature fail；乱填 AK → 401 APIG.0301 not found；
 * 正确三元组 → 业务层错误码（验签已通过）。三个向量的 signature/payloadHash/
 * signedHeaders/canonicalRequest/stringToSign 必须与实现、与 Python 版逐字节一致。
 */
const VECTORS = [
  {
    name: "POST chat/completions + STS",
    input: {
      method: "POST",
      url: "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions",
      headers: { "Content-Type": "application/json" },
      bodyText: '{"a":1}',
      accessKey: "TESTAK123",
      secretKey: "TESTSK456",
      securityToken: "TESTSECRETTOKEN",
      now: new Date("2026-10-30T00:00:00Z"),
    },
    expect: {
      signature: "c053d44502ba0e7a4f6b84a9444ad37b66df9deacdb309fd56a3b480e58deb88",
      payloadHash: "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862",
      signedHeaders: "content-type;host;x-sdk-date;x-security-token",
      stringToSign:
        "SDK-HMAC-SHA256\n20261030T000000Z\n2e9efaae82a1a97f489882d1b426a6d6c7f771b273931c6e3cef787689bbed13",
    },
  },
  {
    name: "GET 带 query 且无 STS",
    input: {
      method: "GET",
      url: "https://opengw.developer.huaweicloud.com/api/v1/gateway/config?channel=examination&b=2",
      headers: {},
      accessKey: "AK2",
      secretKey: "SK2",
      now: new Date("2026-01-01T12:00:00Z"),
    },
    expect: {
      signature: "9cabb3353b3bc20e61a204d7a615275ed708638d98b8e9b17ca5f5cf1387505f",
      payloadHash: EMPTY_BODY_SHA256,
      signedHeaders: "host;x-sdk-date",
      canonicalRequestStarts: "GET\n/api/v1/gateway/config/\nb=2&channel=examination\n",
    },
  },
  {
    name: "小写 method + 自定义业务头 + 中文 body",
    input: {
      method: "post",
      url: "https://opengw.developer.huaweicloud.com/examination/v1/chat/completions",
      headers: { "Content-Type": "application/json", "Agent-Type": "PromptCenter" },
      bodyText: '{"model":"glm-5.2","messages":[{"role":"user","content":"你好"}]}',
      accessKey: "AK3",
      secretKey: "SK3",
      securityToken: "STS3",
      now: new Date("2026-12-31T23:59:59Z"),
    },
    expect: {
      signature: "c89f86168f9b05b1f49a8d6503f4f6be009751763e556ec0ac5e7bc536900e1b",
      payloadHash: "04ccbb69db1e532bd32a42a3ccb0ccb63d310d06fc395df57227352871a15a62",
      signedHeaders: "agent-type;content-type;host;x-sdk-date;x-security-token",
    },
  },
];

describe("huaweiApigSign — 与已验证实现逐字节对拍", () => {
  for (const v of VECTORS) {
    it(`${v.name} 签名正确`, () => {
      const r = signRequest(v.input);
      const sig = r.authorization.split("Signature=")[1];
      expect(sig).toBe(v.expect.signature);
      expect(r.payloadHash).toBe(v.expect.payloadHash);
      expect(r.signedHeaders).toBe(v.expect.signedHeaders);
      if (v.expect.stringToSign) expect(r.stringToSign).toBe(v.expect.stringToSign);
      if (v.expect.canonicalRequestStarts) {
        expect(r.canonicalRequest.startsWith(v.expect.canonicalRequestStarts)).toBe(true);
      }
    });
  }

  it("Authorization 头格式符合华为规范（算法与 Access 之间是空格，不是逗号）", () => {
    const { authorization } = signRequest(VECTORS[0].input);
    expect(authorization).toMatch(
      /^SDK-HMAC-SHA256 Access=TESTAK123, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
    );
  });

  it("signedHeaders 按小写字母序，且包含 host 与 x-sdk-date", () => {
    const { signedHeaders: sh } = signRequest(VECTORS[2].input);
    const parts = sh.split(";");
    expect(parts).toEqual([...parts].sort());
    expect(parts).toContain("host");
    expect(parts).toContain("x-sdk-date");
  });

  it("没有 STS 时不出现 X-Security-Token（也不参与签名）", () => {
    const r = signRequest(VECTORS[1].input);
    expect(r.headers["X-Security-Token"]).toBeUndefined();
    expect(r.signedHeaders).not.toContain("x-security-token");
  });

  it("有 STS 时自动加头并参与签名", () => {
    const r = signRequest(VECTORS[0].input);
    expect(r.headers["X-Security-Token"]).toBe("TESTSECRETTOKEN");
    expect(r.signedHeaders).toContain("x-security-token");
  });

  it("GET 无 body 用空 body 的 sha256", () => {
    const r = signRequest({ ...VECTORS[1].input });
    expect(r.payloadHash).toBe(EMPTY_BODY_SHA256);
  });

  it("空 body 字符串的 sha256 恰好等于 EMPTY_BODY_SHA256（这是正确行为，不是缺陷）", () => {
    const r = signRequest({ ...VECTORS[1].input, bodyText: "" });
    expect(r.payloadHash).toBe(EMPTY_BODY_SHA256);
  });

  it("signedHeaders 便捷封装返回可直接用于 fetch 的头", () => {
    const h = signedHeaders(VECTORS[0].input);
    expect(h.Authorization).toContain("SDK-HMAC-SHA256 Access=TESTAK123");
    expect(h.host).toBe("snap-access.cn-north-4.myhuaweicloud.com");
    expect(h["X-Sdk-Date"]).toBe("20261030T000000Z");
  });
});

describe("canonicalUri / canonicalQuery / sdkDate / huaweiEncode", () => {
  it("canonicalUri 结尾补斜杠", () => {
    expect(canonicalUri("/api/v2/chat/completions")).toBe("/api/v2/chat/completions/");
    expect(canonicalUri("/a/")).toBe("/a/");
    expect(canonicalUri("")).toBe("/");
  });

  it("canonicalUri 对每段做华为编码（含 !'()* 与中文）", () => {
    expect(canonicalUri("/a b/c")).toBe("/a%20b/c/");
    expect(canonicalUri("/x(y)")).toBe("/x%28y%29/");
    expect(canonicalUri("/模/型")).toBe(`/${encodeURIComponent("模")}/${encodeURIComponent("型")}/`);
  });

  it("huaweiEncode 编码 !'()* 而保留 -_.~", () => {
    expect(huaweiEncode("a-b_c.d~e")).toBe("a-b_c.d~e");
    expect(huaweiEncode("!")).toBe("%21");
    expect(huaweiEncode("'")).toBe("%27");
    expect(huaweiEncode("(")).toBe("%28");
    expect(huaweiEncode(")")).toBe("%29");
    expect(huaweiEncode("*")).toBe("%2A");
  });

  it("canonicalQuery 按 key 字典序排序", () => {
    expect(canonicalQuery("?channel=examination&b=2")).toBe("b=2&channel=examination");
    expect(canonicalQuery("?z=1&a=2&m=3")).toBe("a=2&m=3&z=1");
  });

  it("canonicalQuery 空值返回空串，且不等同于占位", () => {
    expect(canonicalQuery("")).toBe("");
    expect(canonicalQuery("?")).toBe("");
    expect(canonicalQuery(undefined)).toBe("");
  });

  it("canonicalQuery 会先解码再重编码，避免二次编码", () => {
    expect(canonicalQuery("?q=a%20b")).toBe("q=a%20b");
    expect(canonicalQuery("?q=a+b")).toBe("q=a%20b");
  });

  it("sdkDate 输出 YYYYMMDDTHHmmssZ（UTC）", () => {
    expect(sdkDate(new Date("2026-10-30T00:00:00Z"))).toBe("20261030T000000Z");
    expect(sdkDate(new Date("2026-01-02T03:04:05Z"))).toBe("20260102T030405Z");
  });

  it("sdkDate 用 UTC 而非本地时区", () => {
    const d = new Date("2026-06-15T23:30:00Z");
    expect(sdkDate(d).endsWith("Z")).toBe(true);
    expect(sdkDate(d)).toBe("20260615T233000Z");
  });
});
