// 验证代理重试 + 禁止直连降级
//
// 说明：proxyFetch 在模块加载时把 globalThis.fetch 存为 originalFetch，之后
// 所有请求都走那个引用。想观察「代理到底试了几次、有没有降级」，最可靠的方式
// 是让真实 fetch 去连一个必然失败的目标（127.0.0.1:9 无服务监听），然后断言
// 控制台日志与最终错误文案 —— 这正是调用方与用户看到的东西。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PROXY_RETRY_ATTEMPTS } from "../../open-sse/config/runtimeConfig.js";

const DEAD_PROXY = "http://127.0.0.1:9";

describe("ProxyFetch resilience", () => {
  let proxyAwareFetch;
  let warnSpy;

  beforeEach(async () => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  const warningsText = () => warnSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("defaults match the documented resilience budget", () => {
    // 2 次重试 + 首次 = 3 次尝试；退避 400ms -> 800ms
    expect(PROXY_RETRY_ATTEMPTS).toBe(2);
  });

  it("retries the proxy instead of giving up on the first failure", async () => {
    await proxyAwareFetch(
      "http://example.invalid/x",
      {},
      { connectionProxyEnabled: true, connectionProxyUrl: DEAD_PROXY, directFallback: true },
    ).catch(() => {});

    const text = warningsText();
    // 每次失败都记一条 attempt N/M
    const retryLines = text.match(/Proxy attempt \d+\/\d+ failed/g) || [];
    expect(retryLines.length).toBeGreaterThanOrEqual(1);
    // 最终放弃时说明总共试了几次
    expect(text).toMatch(/Proxy failed after \d+ attempt\(s\)/);
  }, 30000);

  it("hard-fails instead of going direct when directFallback is false", async () => {
    await expect(
      proxyAwareFetch(
        "http://example.invalid/x",
        {},
        { connectionProxyEnabled: true, connectionProxyUrl: DEAD_PROXY, directFallback: false },
      ),
    ).rejects.toThrow(/Proxy required but failed after \d+ attempt\(s\)/);

    // 关键：绝不能出现 "falling back to direct"
    expect(warningsText()).not.toMatch(/falling back to direct/);
  }, 30000);

  it("keeps the legacy behaviour for callers that did not opt out", async () => {
    // 不传 directFallback -> 应当降级（日志里出现 falling back to direct）
    await proxyAwareFetch(
      "http://example.invalid/x",
      {},
      { connectionProxyEnabled: true, connectionProxyUrl: DEAD_PROXY },
    ).catch(() => {});

    expect(warningsText()).toMatch(/falling back to direct/);
  }, 30000);

  // [merge 092c86d7] 直连兜底必须有界，否则被墙端点会死等数百秒(issue #76: 788s)
  it("bounds the direct fallback so a blocked host cannot hang forever", async () => {
    // 把兜底超时压到 300ms，用一个永不响应的地址模拟被墙端点
    vi.resetModules();
    process.env.DIRECT_FALLBACK_TIMEOUT_MS = "300";

    const started = Date.now();
    const { proxyAwareFetch: pf } = await import("../../open-sse/utils/proxyFetch.js");

    await pf(
      "http://10.255.255.1/x", // 不可路由地址：连不通报错，或超时被 abort
      {},
      { connectionProxyEnabled: true, connectionProxyUrl: DEAD_PROXY },
    ).catch(() => {});

    const elapsed = Date.now() - started;
    // 3 次代理尝试(0+400+800ms 退避) + 300ms 直连兜底，宽松上限 30s
    // 关键断言：必须远小于「无界死等」的量级
    expect(elapsed).toBeLessThan(30000);
    delete process.env.DIRECT_FALLBACK_TIMEOUT_MS;
  }, 60000);

  it("does not double-time when the caller already passed a signal", async () => {
    vi.resetModules();
    const { proxyAwareFetch: pf } = await import("../../open-sse/utils/proxyFetch.js");

    const ctrl = new AbortController();
    // 调用方自己 200ms 就 abort —— 兜底不应再叠一层 60s 计时
    const timer = setTimeout(() => ctrl.abort(new Error("caller abort")), 200);
    const started = Date.now();

    await pf(
      "http://10.255.255.1/x",
      { signal: ctrl.signal },
      { connectionProxyEnabled: true, connectionProxyUrl: DEAD_PROXY },
    ).catch(() => {});
    clearTimeout(timer);

    expect(Date.now() - started).toBeLessThan(30000);
  }, 60000);
});
