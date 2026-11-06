// 模型发现配置覆盖度契约 —— 防"声明了却打不通"这一类漂移。
//
// 背景（2026-11-06）：registry 里声明 `modelsFetcher` 的 provider，详情页会拿到一个
// 模型发现按钮；但按钮打的是 `/api/providers/[id]/models`，它只认 route.js 里的
// `PROVIDER_MODELS_CONFIG`。两处各自硬编码，于是出现「registry 写了、后端没配」的
// provider：按钮照常渲染，一点就是 400 does not support models listing。
// 本测试把「有 modelsFetcher ⇒ 必须有 config 条目」固化成不变量。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REG_DIR = path.join(ROOT, "open-sse/providers/registry");
const ROUTE_REL = "src/app/api/providers/[id]/models/route.js";
const PAGE_REL = "src/app/(dashboard)/dashboard/providers/[id]/page.js";

// modelsFetcher.url 指向「聚合目录」而不是本 provider 模型列表的例外。
// models.dev/api.json 是按 provider 名索引的字典（{"nano-gpt":{…},"openrouter":{…}}），
// 不是模型数组，语义上不该接进模型发现，属于有意排除而非遗漏。
const AGGREGATE_CATALOG_EXCEPTIONS = new Set(["mimo-free"]);

// 2026-11-06 这批补齐的 provider —— 前端入口也要在，否则后端修好了 UI 仍无按钮。
const BACKFILLED = ["venice", "opencode", "opencode-zen", "kilocode", "tokenrouter"];

function collectModelsFetchers() {
  const out = {};
  for (const f of readdirSync(REG_DIR)) {
    if (!f.endsWith(".js")) continue;
    const src = readFileSync(path.join(REG_DIR, f), "utf8");
    const block = src.match(/modelsFetcher\s*:\s*\{([^}]*)\}/s);
    if (!block) continue;
    const url = block[1].match(/url:\s*"([^"]+)"/)?.[1];
    const id = src.match(/^\s*id:\s*"([^"]+)"/m)?.[1];
    if (id && url) out[id] = url;
  }
  return out;
}

function collectConfigKeys() {
  const src = readFileSync(path.join(ROOT, ROUTE_REL), "utf8");
  const block = src.match(/const PROVIDER_MODELS_CONFIG\s*=\s*\{(.*?)\n\};/s);
  if (!block) throw new Error("PROVIDER_MODELS_CONFIG 段未找到（route.js 结构变了？）");
  return new Set([...block[1].matchAll(/^\s{2}["']?([A-Za-z0-9_.\-]+)["']?\s*:/gm)].map((m) => m[1]));
}

const fetchers = collectModelsFetchers();
const configKeys = collectConfigKeys();

describe("模型发现配置覆盖度", () => {
  it("每个声明 modelsFetcher 的 provider 都有 PROVIDER_MODELS_CONFIG 条目", () => {
    const missing = Object.keys(fetchers)
      .filter((id) => !configKeys.has(id))
      .filter((id) => !AGGREGATE_CATALOG_EXCEPTIONS.has(id));
    expect(missing).toEqual([]);
  });

  it("例外名单里的每个 provider 都确实指向聚合目录（不是借例外掩盖漏配）", () => {
    for (const id of AGGREGATE_CATALOG_EXCEPTIONS) {
      expect(fetchers[id], `${id} 已无 modelsFetcher，请从例外名单移除`).toBeTruthy();
      expect(fetchers[id]).toMatch(/models\.dev/);
    }
  });

  it("补齐的 provider：config URL 与 registry modelsFetcher 完全一致（防两处各写一个）", () => {
    const src = readFileSync(path.join(ROOT, ROUTE_REL), "utf8");
    for (const id of BACKFILLED) {
      expect(fetchers[id], `${id} 缺少 modelsFetcher`).toBeTruthy();
      const candidates = [
        `"${id}": createOpenAIModelsConfig("${fetchers[id]}")`,
        `${id}: createOpenAIModelsConfig("${fetchers[id]}")`,
      ];
      expect(
        candidates.some((c) => src.includes(c)),
        `${id} 的 config 未指向 ${fetchers[id]}`,
      ).toBe(true);
    }
  });

  it("补齐的 provider：详情页前端入口也接上了", () => {
    const page = readFileSync(path.join(ROOT, PAGE_REL), "utf8");
    const block = page.match(/OFFICIAL_MODELS_REFRESH_PROVIDERS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(block, "OFFICIAL_MODELS_REFRESH_PROVIDERS 未找到").toBeTruthy();
    for (const id of BACKFILLED) {
      expect(block[1]).toContain(`"${id}"`);
    }
  });

  it("每个 modelsFetcher 的 provider 在 registry 里都有静态兜底或 custom resolver（不允许只有在线目录）", () => {
    // 只对「纳入模型发现」的 provider 断言：离线时要能给出可选项。
    for (const id of [...BACKFILLED, "opendesign-amr"]) {
      const file = readdirSync(REG_DIR).find((f) => f.endsWith(".js") && readFileSync(path.join(REG_DIR, f), "utf8").match(new RegExp(`^\\s*id:\\s*"${id}"`, "m")));
      expect(file, `${id} 的 registry 文件未找到`).toBeTruthy();
      const src = readFileSync(path.join(REG_DIR, file), "utf8");
      expect(src).toMatch(/models\s*:\s*\[/);
    }
  });
});
