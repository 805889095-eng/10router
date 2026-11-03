/**
 * Loomy (讯飞) provider registration.
 *
 * The whole point of the entry: an out-of-the-box free pool that does not need
 * a custom node. Three things break silently if the wiring drifts, so they are
 * pinned here:
 *   - the registry row exists with the eight measured models;
 *   - `features.usageApikey` is spelled exactly as providers.js filters on
 *     (camel-case `usageApiKey` would silently drop the points card);
 *   - the /models probe uses the custom `token:` header, not Bearer.
 */

import { describe, it, expect } from "vitest";
import loomy from "../../open-sse/providers/registry/loomy.js";
import registry from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("loomy registry entry", () => {
  it("is registered under the freeTier category", () => {
    expect(loomy.id).toBe("loomy");
    expect(loomy.category).toBe("freeTier");
    expect(loomy.transport.baseUrl).toBe("https://loomyad.xunfei.cn/api/v1/chat/completions");
  });

  it("exposes the eight measured models", () => {
    expect(loomy.models.map((m) => m.id)).toEqual([
      "spark-x2.6",
      "qwen3.8-flash",
      "qwen-3.8-max",
      "DeepSeek-V4.1-Flash",
      "deepseek-v4-flash-0731",
      "MiniMax-M3",
      "Kimi-k2.6",
      "GLM-5.3-Flash",
    ]);
  });

  it("is reachable through the registry index", () => {
    const found = registry.filter((r) => r.id === "loomy");
    expect(found).toHaveLength(1);
    expect(found[0].alias).toBe("loomy");
  });

  it("opts into the api-key points card with the exact flag providers.js filters on", () => {
    expect(loomy.features?.usage).toBe(true);
    expect(loomy.features?.usageApikey).toBe(true);
  });

  it("declares capabilities for the case-sensitive upstream ids", () => {
    // `DeepSeek-V4.1-Flash` is capitalised upstream; without an exact entry it
    // falls into the generic *deepseek-v4* text profile and loses vision.
    const ds = getCapabilitiesForModel("loomy", "DeepSeek-V4.1-Flash");
    expect(ds.vision).toBe(true);
    expect(ds.reasoning).toBe(true);
    expect(ds.contextWindow).toBe(1000000);

    const kimi = getCapabilitiesForModel("loomy", "Kimi-k2.6");
    expect(kimi.contextWindow).toBe(262144);

    const glm = getCapabilitiesForModel("loomy", "GLM-5.3-Flash");
    expect(glm.maxOutput).toBe(131072);
  });
});
