/**
 * Antigravity image adapter — reference images, aspect ratio, negative prompt.
 *
 * The adapter is the only place that knows how to turn an OpenAI-style image
 * request into the Antigravity envelope. Three behaviours here were silently
 * missing and are easy to regress:
 *   - reference images were dropped (the executor's image branch was text-only)
 *   - body.size never reached generationConfig (no -WxH model suffix)
 *   - negative_prompt vanished (Gemini has no such parameter)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getExecutor: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: mocks.getExecutor,
}));

import antigravityImage from "../../open-sse/handlers/imageProviders/antigravity.js";

function pngDataUri(seed) {
  // Any base64 blob works; the adapter only splits on the data-URI prefix.
  return `data:image/png;base64,${Buffer.from(`img-${seed}`).toString("base64")}`;
}

function okResponse(candidates) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ response: { candidates } }),
    text: async () => "",
  };
}

describe("antigravity image adapter", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.getExecutor.mockReset();
    mocks.execute.mockResolvedValue({
      response: okResponse([
        { content: { parts: [{ inlineData: { data: "OUT" } }] } },
      ]),
    });
    mocks.getExecutor.mockReturnValue({ execute: mocks.execute });
  });

  function sentBody() {
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    return mocks.execute.mock.calls[0][0];
  }

  it("keeps every reference image and puts them before the prompt", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "restyle this", reference_images: [pngDataUri("a"), pngDataUri("b"), pngDataUri("c")] },
      { accessToken: "t" },
      null
    );

    const parts = sentBody().body.contents[0].parts;
    expect(parts).toHaveLength(4);
    expect(parts.filter((p) => p.inlineData)).toHaveLength(3);
    expect(parts[parts.length - 1]).toEqual({ text: "restyle this" });
  });

  it("accepts the object shapes clients send for a single image", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "edit", image: { image_url: { url: pngDataUri("x") } } },
      { accessToken: "t" },
      null
    );

    const parts = sentBody().body.contents[0].parts;
    expect(parts[0].inlineData).toBeDefined();
    expect(parts[0].inlineData.data).toBe(Buffer.from("img-x").toString("base64"));
  });

  it("caps reference images at 10", async () => {
    const many = Array.from({ length: 14 }, (_, i) => pngDataUri(String(i)));
    await antigravityImage.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "p", reference_images: many },
      { accessToken: "t" },
      null
    );

    const parts = sentBody().body.contents[0].parts;
    expect(parts.filter((p) => p.inlineData)).toHaveLength(10);
  });

  it("derives the aspect-ratio model suffix from body.size", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "p", size: "1792x1024" },
      { accessToken: "t" },
      null
    );

    expect(sentBody().model).toBe("gemini-3.1-flash-image-16x9");
  });

  it("prefers an explicit body.aspect_ratio over body.size", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "p", size: "1792x1024", aspect_ratio: "9:16" },
      { accessToken: "t" },
      null
    );

    expect(sentBody().model).toBe("gemini-3.1-flash-image-9x16");
  });

  it("does not double-append a suffix that is already there", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-3.1-flash-image-16x9",
      { prompt: "p", size: "1792x1024" },
      { accessToken: "t" },
      null
    );

    expect(sentBody().model).toBe("gemini-3.1-flash-image-16x9");
  });

  it("folds negative_prompt into the prompt text", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-3.1-flash-image",
      { prompt: "a cat", negative_prompt: "blurry, watermark" },
      { accessToken: "t" },
      null
    );

    const parts = sentBody().body.contents[0].parts;
    expect(parts[parts.length - 1].text).toBe("a cat\n\nNegative prompt: blurry, watermark");
  });

  it("swaps a non-image model for a real image model", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-4-argon-high",
      { prompt: "p" },
      { accessToken: "t" },
      null
    );

    // No size/aspect_ratio given → no suffix; the executor's parseImageConfig
    // defaults aspectRatio to 1:1 for a bare model name.
    expect(sentBody().model).toBe("gemini-3.1-flash-image");
  });

  it("still appends the suffix after swapping a non-image model", async () => {
    await antigravityImage.executeViaExecutor(
      "gemini-4-argon-high",
      { prompt: "p", size: "1024x1792" },
      { accessToken: "t" },
      null
    );

    expect(sentBody().model).toBe("gemini-3.1-flash-image-9x16");
  });

  it("surfaces the upstream quota reset time on failure", async () => {
    const resetAt = new Date(Date.now() + 3_600_000).toISOString();
    mocks.execute.mockResolvedValue({
      response: {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({
          error: { details: [{ metadata: { quotaResetTimeStamp: resetAt } }] },
        }),
        json: async () => ({}),
      },
    });

    await expect(
      antigravityImage.executeViaExecutor("gemini-3.1-flash-image", { prompt: "p" }, { accessToken: "t" }, null)
    ).rejects.toMatchObject({
      status: 429,
      resetsAtMs: new Date(resetAt).getTime(),
    });
  });

  it("normalizes inlineData candidates into an OpenAI image payload", () => {
    const out = antigravityImage.normalize(
      { candidates: [{ content: { parts: [{ inlineData: { data: "QQ==" } }] } }] },
      "a cat"
    );
    expect(out.data).toEqual([{ b64_json: "QQ==" }]);
    expect(typeof out.created).toBe("number");
  });
});
