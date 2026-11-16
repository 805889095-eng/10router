#!/usr/bin/env node
/**
 * 排水等待 CLI —— 由 fpk 的 shell 脚本在「停止/重启主应用」之前调用。
 *
 *   node drain-wait.js --trigger=manual|schedule [--port=20127] [--max-ms=120000] [--poll-ms=5000]
 *
 * 退出码（shell 里按此分支）：
 *   0  proceed      —— 已排空，或手动轮等满窗口（用户指令优先）
 *   2  defer        —— 定时轮窗口耗尽仍有活跃请求，本轮更新应延后重试
 *   0  （健康端点不可达） —— 视作 0 在途，不阻塞更新（与上游同口径：
 *       旧版主应用没有该字段，探测失败绝不造成「永远更新不了」）
 *
 * 只用 http + 内置模块，无外部依赖，可在 fpk 的 node 环境直接跑。
 */
"use strict";

const http = require("http");
const { drainDecision } = require("./drain-lib.js");

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}

const TRIGGER = arg("trigger", "manual");
const PORT = Number(arg("port", "20127"));
const MAX_MS = Number(arg("max-ms", "120000"));
const POLL_MS = Number(arg("poll-ms", "5000"));

function mainHealthBody(timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port: PORT, path: "/api/health", timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const startedAt = Date.now();
  let lastActive = 0;
  for (;;) {
    const body = await mainHealthBody();
    const active =
      body && Number.isFinite(Number(body.activeRequests)) ? Number(body.activeRequests) : 0;
    lastActive = active;
    const waitedMs = Date.now() - startedAt;
    const decision = drainDecision({ active, waitedMs, maxWaitMs: MAX_MS, trigger: TRIGGER });

    if (decision === "proceed") {
      if (active > 0) {
        console.log(`[drain] 窗口耗尽仍有 ${active} 个在途请求，按手动指令继续（${Math.round(waitedMs / 1000)}s）`);
      } else {
        console.log("[drain] 在途请求已排空，继续");
      }
      process.exit(0);
    }
    if (decision === "defer") {
      console.log(`[drain] 活跃请求未排空（${active} 个, 已等 ${Math.round(waitedMs / 1000)}s）—— 本轮自动更新延后重试`);
      process.exit(2);
    }
    console.log(`[drain] 等待排空：在途 ${active} 个（已等 ${Math.round(waitedMs / 1000)}s / 上限 ${Math.round(MAX_MS / 1000)}s）`);
    await sleep(POLL_MS);
  }
})().catch((e) => {
  // 探测自身出错绝不阻塞更新：按 0 在途处理
  console.log(`[drain] 探测异常（${e && e.message}），跳过我按 0 在途处理`);
  process.exit(0);
});
