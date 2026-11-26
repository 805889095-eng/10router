import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import intl from "../../open-sse/providers/registry/codebuddy-intl.js";
import cn from "../../open-sse/providers/registry/codebuddy-cn.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const MODEL_ROW = read("../../src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js");
const locales = {
  "zh-CN": JSON.parse(read("../../public/i18n/literals/zh-CN.json")),
  "zh-TW": JSON.parse(read("../../public/i18n/literals/zh-TW.json")),
};

describe("paidTier registry flag", () => {
  const byId = Object.fromEntries(intl.models.map((m) => [m.id, m]));

  it("marks the whole Claude family the credit page shows behind a lock", () => {
    // 2026-10-09 credit page: every Claude row carries the paid-tier lock. The
    // flag is what lets ModelRow say so, instead of a user discovering it as a
    // 11102 and concluding the catalog is broken.
    const claude = intl.models.filter((m) => m.id.startsWith("claude-"));
    expect(claude.length).toBe(8);
    for (const m of claude) expect([m.id, m.paidTier]).toEqual([m.id, true]);
  });

  it("does not mark the models that answer on a free account", () => {
    // The flag means "subscription-gated", not "unverified". These all answer
    // 200 on a free tier, so marking them would send users chasing a lock that
    // is not the reason anything fails.
    for (const id of ["gpt-6-astra", "gpt-6-sol", "glm-5.3", "kimi-k3", "hy4-preview", "hy3"]) {
      expect([id, byId[id].paidTier]).toEqual([id, undefined]);
    }
  });

  it("keeps the flag independent of the multiplier", () => {
    // The two facts are about different things (price vs access). Sonnet-4.6
    // carries both (its rate is an alignment to Sonnet-5, not a page figure),
    // so assert the badge does not depend on which multiplier is present.
    const sonnet = byId["claude-sonnet-4.6"];
    expect(sonnet.paidTier).toBe(true);
    // The guard on the multiplier badge must not wrap the paid-tier badge: a
    // paid-tier model with no published rate would then lose its lock entirely.
    expect(MODEL_ROW).not.toContain("displayMultiplier !== null && model.paidTier");
  });
});

describe("paid-tier badge rendering contract", () => {
  it("renders a warning badge with a lock icon when the flag is set", () => {
    expect(MODEL_ROW).toContain("model.paidTier && (");
    expect(MODEL_ROW).toContain('variant="warning"');
    expect(MODEL_ROW).toContain('icon="lock"');
    expect(MODEL_ROW).toContain('translate("Paid tier")');
  });

  it("explains the badge in a tooltip that does not over-promise a reason", () => {
    // "Paid tier" alone would read as a price tier. But the tooltip must not
    // assert a single cause either: these ids answered 11102 on this machine's
    // account while the credit page showed a "coming soon" panel, so the truth
    // is "tier-gated OR still rolling out" — and a paid user who still gets
    // 11102 should not be sent chasing their plan.
    expect(MODEL_ROW).toContain('translate("Not available on every plan yet — needs a paid tier, or is still rolling out")');
    expect(MODEL_ROW).toContain("<Tooltip");
  });

  it("declares the flag in propTypes so a typo cannot pass silently", () => {
    expect(MODEL_ROW).toContain("paidTier: PropTypes.bool");
  });

  });

describe("subPriority registry flag", () => {
  const cnById = Object.fromEntries(cn.models.map((m) => [m.id, m]));
  const intlById = Object.fromEntries(intl.models.map((m) => [m.id, m]));

  it("marks exactly the rows the credit page tags 订阅优先", () => {
    // 2026-11-25 CN 客户端第五版：订阅优先标签扩到 GLM-5.3 / 5.3-Flash / Kimi-K3.1-Pro
    // 与 K2.8-Preview；Step-5-Preview 自第三版起不再带标。GLM-5.4 与 5.3 同价但
    // **不带**标签（卡面只有倍率），不得外溢。
    expect(cnById["glm-5.3"].subPriority).toBe(true);
    expect(cnById["glm-5.3-flash"].subPriority).toBe(true);
    expect(cnById["kimi-k3.1-pro"].subPriority).toBe(true);
    expect(cnById["kimi-k2.8-preview"].subPriority).toBe(true);
    expect(intlById["kimi-k2.8-preview"].subPriority).toBe(true);
    expect(cnById["glm-5.4"].subPriority).toBeUndefined();
    const tagged = [...cn.models, ...intl.models].filter((m) => m.subPriority);
    expect(tagged.map((m) => `${m.id}`).sort()).toEqual([
      "glm-5.3",
      "glm-5.3-flash",
      "kimi-k2.8-preview",
      "kimi-k2.8-preview",
      "kimi-k3.1-pro",
    ]);
  });

  it("does not mark the models that have no such tag", () => {
    // The Claude line carries the paid-tier LOCK, not 订阅优先 — conflating the
    // two would put a queueing claim on rows the page never gave it to.
    for (const m of intl.models.filter((x) => x.id.startsWith("claude-"))) {
      expect([m.id, m.subPriority]).toEqual([m.id, undefined]);
    }
  });

  it("keeps the two flags independent on the same row", () => {
    // GLM-5.3 是订阅优先但不在付费锁后面 —— 两个徽章回答不同的问题：
    // "是否限档位？" vs "是否排队优先？"。（Step-5-Preview 自第三版起已无订阅优先标签。）
    expect(cnById["glm-5.3"].paidTier).toBeUndefined();
    expect(cnById["glm-5.3"].subPriority).toBe(true);
  });

  it("records Step-5-Preview's published rate and 1M context", () => {
    // 客户端第四/五版 0.33x（旧积分页是 0.43x）；上下文档 300/600/1M，行解析到 1M 上限。
    expect(cnById["step-5-preview"]).toMatchObject({ rateMultiplier: 0.33 });
    expect(getCapabilitiesForModel("codebuddy-cn", "step-5-preview").contextWindow).toBe(1000000);
  });
});

describe("subscription-priority badge rendering contract", () => {
  it("renders an info badge with a bolt icon, distinct from the paid-tier lock", () => {
    // info + bolt vs warning + lock: two visually distinct marks, so a row that
    // ever carries both does not read as one ambiguous badge.
    expect(MODEL_ROW).toContain("model.subPriority && (");
    expect(MODEL_ROW).toContain('translate("Sub priority")');
    expect(MODEL_ROW).toContain('translate("Prioritized for subscribers")');
    expect(MODEL_ROW).toContain("subPriority: PropTypes.bool");
    const sub = MODEL_ROW.slice(MODEL_ROW.indexOf("model.subPriority && ("));
    expect(sub.slice(0, 400)).toContain('variant="info"');
    expect(sub.slice(0, 400)).toContain('icon="bolt"');
  });

  it("does not nest the sub-priority badge inside the paid-tier guard", () => {
    // Otherwise a 订阅优先 row without the lock would lose the badge entirely.
    expect(MODEL_ROW).not.toContain("model.paidTier && model.subPriority");
  });
});

describe("paid-tier badge i18n", () => {
  it("has both strings in every locale that has a table", () => {
    // en.json does not exist by design — English falls back to the key itself.
    for (const [name, table] of Object.entries(locales)) {
      expect([name, typeof table["Paid tier"]]).toEqual([name, "string"]);
      expect([name, typeof table["Not available on every plan yet — needs a paid tier, or is still rolling out"]]).toEqual([name, "string"]);
      expect([name, typeof table["Sub priority"]]).toEqual([name, "string"]);
      expect([name, typeof table["Prioritized for subscribers"]]).toEqual([name, "string"]);
    }
  });

  it("does not leave a Chinese string sitting in an untranslated slot", () => {
    // The repo convention: zh-CN / zh-TW carry real translations. A copy-pasted
    // simplified form in zh-TW is the failure this catches.
    expect(locales["zh-TW"]["Paid tier"]).toBe("付費檔");
    expect(locales["zh-TW"]["Paid tier"]).not.toBe(locales["zh-CN"]["Paid tier"]);
  });
});