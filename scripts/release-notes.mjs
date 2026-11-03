#!/usr/bin/env node
/**
 * 从用户版更新日志里抽出当前版本那一节，生成 GitHub Release 正文。
 *
 * 设计要点：
 * - 正文取的是「面向用户」的 public/i18n/changelog/<lang>.md，不是完整的
 *   CHANGELOG.md。后者按版本累积了上千行开发细节（含实测数据、根因分析），
 *   直接贴到 Release 页面会把资产列表挤到屏幕外。
 * - 仓库地址不硬编码：优先 GITHUB_REPOSITORY（Actions 自带），本地回退到
 *   origin remote 解析。这样仓库改名/迁到组织下都不用改脚本。
 * - 上一个版本号从用户版日志里顺位取，用来拼 compare 链接；取不到就省略。
 * - 找不到当前版本时**报错退出**，不输出占位文案 —— 静默产出 "pending"
 *   正是这次要修的问题。
 *
 * 用法：
 *   node scripts/release-notes.mjs                    # 输出到 stdout
 *   node scripts/release-notes.mjs --out notes.md     # 输出到文件
 *   node scripts/release-notes.mjs --version 1.8.6    # 指定版本（补历史 release 用）
 *   node scripts/release-notes.mjs --lang en          # 换语言，默认 zh-CN
 *   node scripts/release-notes.mjs --source changelog # 改从完整开发日志抽
 *                                                     # （早期版本没有用户版段落时用）
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_LANG = "zh-CN";

function parseArgs(argv) {
  const args = { out: null, version: null, lang: DEFAULT_LANG, source: "user" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--out") args.out = argv[++i];
    else if (key === "--version") args.version = argv[++i];
    else if (key === "--lang") args.lang = argv[++i];
    else if (key === "--source") args.source = argv[++i];
    else if (key === "--help" || key === "-h") args.help = true;
    else throw new Error(`未知参数: ${key}`);
  }
  if (!["user", "changelog"].includes(args.source)) {
    throw new Error(`--source 只能是 user 或 changelog，收到: ${args.source}`);
  }
  return args;
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

/** 解析仓库 full name（owner/repo），优先 Actions 注入的环境变量。 */
function resolveRepo() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv && fromEnv.includes("/")) return fromEnv;
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/github\.com[:/]+([^/]+)\/([^/\s]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    /* 无 git / 无 origin：下面抛错 */
  }
  throw new Error("无法确定仓库名：设置 GITHUB_REPOSITORY 或配置 origin remote");
}

/**
 * 把用户版日志切成 [{version, heading, body}]。
 * 只认 `## vX.Y.Z` 这类二级标题；`### ✨ 新增` 属于当前版本正文。
 */
function splitSections(markdown) {
  const lines = markdown.split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+v?(\d+\.\d+\.\d+)\b(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { version: m[1], heading: line.replace(/^##\s+/, "").trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);
  for (const s of sections) {
    s.body = s.body.join("\n").replace(/^\s+|\s+$/g, "");
  }
  return sections;
}

function buildNotes({ version, lang, source = "user" }) {
  const path =
    source === "changelog"
      ? join(ROOT, "CHANGELOG.md")
      : join(ROOT, "public", "i18n", "changelog", `${lang}.md`);
  let markdown;
  try {
    markdown = readFileSync(path, "utf8");
  } catch {
    throw new Error(`读不到更新日志: ${path}`);
  }

  const sections = splitSections(markdown);
  const index = sections.findIndex((s) => s.version === version);
  if (index === -1) {
    const known = sections.map((s) => s.version).join(", ") || "（无）";
    throw new Error(`在 ${path} 里找不到 v${version}；现有版本: ${known}`);
  }

  const target = sections[index];
  const previous = sections[index + 1]?.version || null;
  const repo = resolveRepo();
  const base = `https://github.com/${repo}`;

  const parts = [target.body || ""];

  const footer =
    source === "changelog"
      ? []
      : [`**完整开发日志**：[CHANGELOG.md](${base}/blob/main/CHANGELOG.md)`];
  if (previous) {
    footer.push(
      `**本次全部改动**：[v${previous}...v${version}](${base}/compare/v${previous}...v${version})`
    );
  }
  if (footer.length) parts.push("---", footer.join("  \n"));

  return parts.filter(Boolean).join("\n\n") + "\n";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "用法: node scripts/release-notes.mjs [--out 文件] [--version X.Y.Z] [--lang zh-CN] [--source user|changelog]"
    );
    return;
  }
  const version = (args.version || readPackageVersion()).replace(/^v/, "");
  const notes = buildNotes({ version, lang: args.lang, source: args.source });
  if (args.out) {
    writeFileSync(args.out, notes, "utf8");
    process.stderr.write(`已写入 ${args.out}（${notes.length} 字节，v${version}）\n`);
  } else {
    process.stdout.write(notes);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`release-notes: ${error.message}\n`);
  process.exit(1);
}
