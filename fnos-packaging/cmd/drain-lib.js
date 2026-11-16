#!/usr/bin/env node
/**
 * 排水探测决策（移植自上游 10router v1.8.0 issue #97 收尾）。
 *
 * 自动更新/重启会掐断在途与流式请求，所以 swap 前先轮询主应用
 * /api/health 的 activeRequests（usageRepo 在途注册表的内存计数）。
 *   active <= 0 / 字段缺失 / 非数值（旧版主应用） → proceed
 *   有活跃请求且窗口未到                          → keep-waiting
 *   窗口耗尽：定时轮 defer（走重试记账），手动轮 proceed（用户指令优先）
 *
 * 纯函数，单独成文件是为了可测（tests/unit/drain-lib.test.js）。
 */
"use strict";

function drainDecision({ active, waitedMs, maxWaitMs, trigger }) {
  const busy = Number.isFinite(Number(active)) && Number(active) > 0;
  if (!busy) return "proceed";
  const waited = Number.isFinite(waitedMs) ? waitedMs : 0;
  const max = Number.isFinite(maxWaitMs) && maxWaitMs > 0 ? maxWaitMs : 0;
  if (waited < max) return "keep-waiting";
  return trigger === "schedule" ? "defer" : "proceed";
}

module.exports = { drainDecision };
