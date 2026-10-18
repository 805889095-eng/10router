// 验证 keep-alive 覆盖整个流（不只是 TTFT 窗口）
//
// 背景：改动前 keep-alive 在首个字节到达后就 stopKeepAlive()，导致模型在
// 流中途长时间思考（reasoning + 80 工具）时下游连接完全静默，被中间层当
// 空闲连接掐断。生产现场：`TerminateError: terminated`，firstByteSeen=true，
// wasConnected=true，sinceStart=117600ms。
//
// 这里用源码断言而不是时序模拟：ReadableStream 的 pull 模型在「上游静默」
// 时会把 pull 挂在 await reader.read() 上，用 fake timers 很难稳定驱动。
// 而这次改动的契约非常窄、非常适合直接断言：
//   1. startKeepAlive 不能再被 firstByteSeen 短路
//   2. pull() 每转发一个 chunk 都要重启保活窗口
//   3. 只有 done / 出错 / 断开才停止保活
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, "../../open-sse/utils/streamHandler.js"), "utf8");

describe("streamHandler keep-alive contract", () => {
  it("does not gate keep-alive on firstByteSeen any more", () => {
    // 旧写法：if (!streamController.isConnected() || firstByteSeen) { stopKeepAlive(); return; }
    expect(SRC).not.toMatch(/firstByteSeen\s*\)\s*\{\s*stopKeepAlive\(\)/);
    expect(SRC).not.toMatch(/isConnected\(\)\s*\|\|\s*firstByteSeen/);
  });

  it("stops keep-alive only on disconnect", () => {
    // 保活定时器内部应当只在「连接已断」时自我停止
    const body = SRC.slice(SRC.indexOf("const startKeepAlive"), SRC.indexOf("// Emit a synthesized terminal"));
    expect(body).toMatch(/if\s*\(!streamController\.isConnected\(\)\)\s*\{\s*stopKeepAlive\(\);\s*return;\s*\}/);
  });

  it("restarts the idle window after forwarding each chunk", () => {
    // controller.enqueue(value) 之后必须重新起表，这样保活只在真正静默时出现
    const idx = SRC.indexOf("controller.enqueue(value)");
    expect(idx).toBeGreaterThan(-1);
    const after = SRC.slice(idx, idx + 400);
    expect(after).toMatch(/startKeepAlive\(controller\)/);
  });

  it("still stops the timer when the stream completes", () => {
    // done 分支必须收尾，否则定时器会泄漏
    const doneIdx = SRC.indexOf("streamController.handleComplete()");
    expect(doneIdx).toBeGreaterThan(-1);
    const before = SRC.slice(Math.max(0, doneIdx - 300), doneIdx);
    expect(before).toMatch(/stopKeepAlive\(\)/);
  });

  it("startKeepAlive is idempotent (clears any previous timer first)", () => {
    const body = SRC.slice(SRC.indexOf("const startKeepAlive"), SRC.indexOf("// Emit a synthesized terminal"));
    // 先 stopKeepAlive() 再 setInterval，避免叠多个定时器
    expect(body).toMatch(/stopKeepAlive\(\);\s*keepAliveTimer\s*=\s*setInterval/);
  });
});
