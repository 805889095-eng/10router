import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import code from "../../open-sse/providers/registry/minimax-code.js";
import codeGlobal from "../../open-sse/providers/registry/minimax-code-global.js";

/**
 * Issue #70 / #71：MiniMax M3.1 Flash 正式 id（去掉 -Preview）必须
 *   1. 出现在两条 minimax-code 线里（否则 /v1/models 看不见）；
 *   2. 有精确能力行，不得落 `*minimax-m3*` 家族兜底——否则
 *      videoInput 被丢（视频块静默剥离）、maxOutput 从 512000 压到 131072、
 *      thinkingCanDisable 语义错位，且全程没有任何报错。
 */
const FORMAL = "MiniMax-M3.1-Flash";
const PREVIEW = "MiniMax-M3.1-Flash-Preview";

describe("MiniMax M3.1 Flash 正式 id", () => {
  it("两条 minimax-code 线都登记了正式 id，且 preview 过渡保留", () => {
    for (const [name, entry] of [["minimax-code", code], ["minimax-code-global", codeGlobal]]) {
      const ids = entry.models.map((m) => m.id);
      expect(ids, name).toContain(FORMAL);
      expect(ids, name).toContain(PREVIEW);
    }
  });

  it("正式 id 命中精确能力行，与 preview 同值", () => {
    const caps = getCapabilitiesForModel("minimax-code", FORMAL);
    const preview = getCapabilitiesForModel("minimax-code", PREVIEW);
    expect(caps).toEqual(preview);
    expect(caps).toMatchObject({
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 512000,
    });
  });

  it("不会落到 *minimax-m3* 家族兜底（maxOutput 不得被压到 131072）", () => {
    const caps = getCapabilitiesForModel("minimax-code", FORMAL);
    expect(caps.maxOutput).not.toBe(131072);
    expect(caps.videoInput).toBe(true);
  });
});
