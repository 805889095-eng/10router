/**
 * OpenAI → Antigravity response translator: thinking chunks.
 *
 * The canonical field is `reasoning_content`, but some lanes stream the same
 * content as `reasoning` or as `reasoning_details[]`. Before this was fixed an
 * alias-only chunk produced an empty `parts` array and the client silently lost
 * the whole thinking pass.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";

function chunk(delta) {
  return { id: "resp_1", model: "gemini-3.8-flash-high", choices: [{ delta, finish_reason: null }] };
}

function thoughtText(out) {
  const parts = out?.response?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.thought).map((p) => p.text).join("");
}

describe("openaiToAntigravityResponse thinking", () => {
  let state;

  beforeEach(() => {
    state = {};
  });

  it("maps reasoning_content to a thought part", () => {
    expect(thoughtText(openaiToAntigravityResponse(chunk({ reasoning_content: "step 1" }), state))).toBe("step 1");
  });

  it("maps the `reasoning` alias so it is not dropped", () => {
    expect(thoughtText(openaiToAntigravityResponse(chunk({ reasoning: "step 2" }), state))).toBe("step 2");
  });

  it("concatenates reasoning_details[] text", () => {
    const out = openaiToAntigravityResponse(
      chunk({ reasoning_details: [{ text: "a" }, { content: "b" }, "c"] }),
      state
    );
    expect(thoughtText(out)).toBe("abc");
  });

  it("still emits plain content alongside an alias thought", () => {
    const out = openaiToAntigravityResponse(chunk({ reasoning: "think", content: "answer" }), state);
    const parts = out.response.candidates[0].content.parts;
    expect(parts).toEqual([
      { thought: true, text: "think" },
      { text: "answer" },
    ]);
  });

  it("does not emit an empty thought part for a content-only chunk", () => {
    const out = openaiToAntigravityResponse(chunk({ content: "answer" }), state);
    const parts = out.response.candidates[0].content.parts;
    expect(parts.some((p) => p.thought)).toBe(false);
  });
});
