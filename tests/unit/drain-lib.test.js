// 排水决策纯函数（移植自上游 v1.8.0 dashboard-lib.drainDecision，issue #97 收尾）。
// 本线的 fpk 打包是 shell，所以决策逻辑独立成 fnos-packaging/cmd/drain-lib.js，
// 由 drain-wait.js CLI 调用、由 cmd/main 的 stop() 触发。
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { drainDecision } = require("../../fnos-packaging/cmd/drain-lib.js");

describe("drainDecision（排水探测决策, issue #97 收尾）", () => {
  const base = { waitedMs: 0, maxWaitMs: 120000, trigger: "schedule" };

  it("无活跃请求 / 字段缺失（旧版主应用）/ 非数值 → 立即 proceed", () => {
    expect(drainDecision({ ...base, active: 0 })).toBe("proceed");
    expect(drainDecision({ ...base, active: undefined })).toBe("proceed");
    expect(drainDecision({ ...base, active: "abc" })).toBe("proceed");
    expect(drainDecision({ ...base, active: -3 })).toBe("proceed");
  });

  it("有活跃请求且窗口未到 → keep-waiting", () => {
    expect(drainDecision({ ...base, active: 2, waitedMs: 0 })).toBe("keep-waiting");
    expect(drainDecision({ ...base, active: 1, waitedMs: 119000 })).toBe("keep-waiting");
  });

  it("窗口耗尽:定时轮 defer、手动轮 proceed(用户指令优先)", () => {
    expect(drainDecision({ ...base, active: 3, waitedMs: 120000 })).toBe("defer");
    expect(drainDecision({ ...base, active: 3, waitedMs: 500000 })).toBe("defer");
    expect(drainDecision({ ...base, active: 3, waitedMs: 120000, trigger: "manual" })).toBe("proceed");
  });

  it("maxWaitMs 缺失/非法按 0 处理 —— 窗口立即耗尽", () => {
    expect(drainDecision({ trigger: "schedule", active: 1, waitedMs: 0, maxWaitMs: undefined })).toBe("defer");
  });
});
