// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec, sizeToAspectRatio } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

// Antigravity accepts up to 10 reference images per request
const MAX_REFERENCE_IMAGES = 10;

// Convert image input (data URI or raw base64) to Gemini inlineData part.
// Accepts a bare string plus the object shapes OpenAI-compatible clients send
// (`{ image_url: { url } }` / `{ url }` / `{ data }` / `{ b64_json }`).
function resolveImageInput(input) {
  if (input && typeof input === "object") {
    input = input.image_url?.url || input.url || input.data || input.b64_json;
  }
  if (!input || typeof input !== "string") return null;
  // data:image/png;base64,... format
  const dataUriMatch = input.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    return { inlineData: { mimeType: dataUriMatch[1], data: dataUriMatch[2] } };
  }
  // Raw base64 string (assume PNG)
  if (/^[A-Za-z0-9+/]/.test(input) && input.length > 100 && !input.startsWith("http")) {
    return { inlineData: { mimeType: "image/png", data: input } };
  }
  return null;
}

// Collect reference images from every accepted request field shape
function collectImageInputs(body) {
  const candidates = [
    body.reference_images,
    body.images,
    body.reference_image,
    body.image,
  ];
  return candidates
    .flatMap((v) => (Array.isArray(v) ? v : v ? [v] : []))
    .slice(0, MAX_REFERENCE_IMAGES);
}

export default {
  // Delegate to executor instead of building URL/headers/body manually
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("antigravity");
    if (!executor) throw new Error("Antigravity executor not found");

    // Ensure an image model is used: a text model here would go down the chat
    // path and never return an image part.
    const isImageModel = (m) => /image|imagen|image-generation/i.test(m || "");
    let targetModel = isImageModel(model) ? model : "gemini-3.1-flash-image";

    // Aspect ratio: explicit body.aspect_ratio wins, then derive from body.size.
    // The ratio rides the model id suffix (-16x9); the executor parses it back
    // into generationConfig.imageConfig.aspectRatio and strips it off the
    // upstream model name.
    let ratio = null;
    if (body.aspect_ratio && /^\d{1,2}:\d{1,2}$/.test(String(body.aspect_ratio))) {
      ratio = String(body.aspect_ratio);
    } else if (body.size && typeof body.size === "string") {
      ratio = sizeToAspectRatio(body.size);
    }
    if (ratio) {
      const suffix = ratio.replace(":", "x");
      if (!targetModel.includes(suffix)) {
        targetModel = `${targetModel}-${suffix}`;
      }
    }

    // Gemini image models have no negative-prompt parameter — fold it into the
    // prompt text instead of silently dropping it.
    const prompt = body.negative_prompt
      ? `${body.prompt}\n\nNegative prompt: ${body.negative_prompt}`
      : body.prompt;

    // Build parts: reference images first, then the text prompt
    const parts = [];
    for (const imageInput of collectImageInputs(body)) {
      const inlineData = resolveImageInput(imageInput);
      if (inlineData) parts.push(inlineData);
    }
    parts.push({ text: prompt });

    const chatBody = {
      contents: [{ role: "user", parts }],
    };

    const result = await executor.execute({
      model: targetModel,
      body: chatBody,
      stream: false,
      credentials,
      log,
    });

    if (!result.response.ok) {
      const text = await result.response.text();
      const err = new Error(text || `HTTP ${result.response.status}`);
      err.status = result.response.status;
      // Surface the upstream quota reset so the account scheduler can bench this
      // connection until it actually refills instead of retrying into a 429 wall.
      try {
        const json = JSON.parse(text);
        const details = json.error?.details || [];
        for (const d of details) {
          const resetTimeStr = d.metadata?.quotaResetTimeStamp;
          if (resetTimeStr) {
            const ms = new Date(resetTimeStr).getTime();
            if (ms > Date.now()) {
              err.resetsAtMs = ms;
              break;
            }
          }
        }
      } catch {}
      throw err;
    }

    return result.response.json();
  },

  normalize: (responseBody, prompt) => {
    const candidates = responseBody.candidates || responseBody.response?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const images = parts.filter((p) => p.inlineData?.data).map((p) => ({
      b64_json: p.inlineData.data,
    }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
