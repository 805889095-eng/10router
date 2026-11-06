// opendesign-amr 模型目录契约。
//
// 背景：AMR 网关的 /v1/models 是权威目录，厂商会随时加模型（2026-11-06 就新上了
// deepseek-v4.1-flash-eco），而详情页的「Fetch OpenDesign Models」按钮要把这些新
// 模型一键拉进自定义模型表。三处必须保持一致，任何一处漂移都会让按钮静默失效：
//
//   1. registry 静态兜底列表（离线 / 未配 Key 时下拉里要能看到）
//   2. registry.transport.modelsFetcher.url（详情页「建议模型」区块的来源）
//   3. /api/providers/[id]/models 的 PROVIDER_MODELS_CONFIG（按钮的后端；缺条目直接
//      400 "does not support models listing"）
//
// 这里同时锁住 (2) 与 (3) 指向同一个 URL —— 两个 URL 各自硬编码，是最容易漂移的地方。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import opendesign from "../../open-sse/providers/registry/opendesign-amr.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const AMR_MODELS_URL = "https://amr-link.open-design.ai/v1/models";

describe("opendesign-amr 模型目录契约", () => {
  it("静态兜底列表包含官方 2026-11-06 新增的 deepseek-v4.1-flash-eco", () => {
    const ids = opendesign.models.map((m) => m.id);
    expect(ids).toContain("deepseek-v4.1-flash-eco");
  });

  it("静态兜底列表 id 不重复", () => {
    const ids = opendesign.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("modelsFetcher 与后端模型路由指向同一个在线目录（防两处漂移）", () => {
    expect(opendesign.transport.modelsFetcher.url).toBe(AMR_MODELS_URL);
    const route = read("src/app/api/providers/[id]/models/route.js");
    expect(route).toContain(`"opendesign-amr": createOpenAIModelsConfig("${AMR_MODELS_URL}")`);
  });

  it("详情页把 opendesign-amr 纳入一键获取按钮作用域并提供按钮文案", () => {
    const page = read("src/app/(dashboard)/dashboard/providers/[id]/page.js");
    expect(page).toContain('providerId === "opendesign-amr"');
    expect(page).toContain("Fetch OpenDesign Models");
  });

  it("仍保留动态拉取与静态兜底的双轨设计（不做硬编码替代）", () => {
    expect(opendesign.transport.modelsFetcher.type).toBe("openai");
    expect(Array.isArray(opendesign.models)).toBe(true);
    expect(opendesign.models.length).toBeGreaterThan(0);
  });
});
