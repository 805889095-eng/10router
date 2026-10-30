import { describe, it, expect } from "vitest";
import { buildCloudCodeProbeError } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { extractAccountsVerificationUrl } from "../../src/shared/utils/validationUrl.js";

// Shaped after the real cloudcode-pa.googleapis.com VALIDATION_REQUIRED body.
const VALIDATION_BODY = JSON.stringify({
  error: {
    code: 403,
    message: "Verify your account to continue.",
    status: "PERMISSION_DENIED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "VALIDATION_REQUIRED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: {
          validation_error_message: "Verify your account to continue.",
          validation_url: "https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini&plt=AKgnsb&flowName=GlifWebSignIn",
        },
      },
    ],
  },
});

describe("buildCloudCodeProbeError (connection test path)", () => {
  it("surfaces the validation URL for a VALIDATION_REQUIRED body", () => {
    const msg = buildCloudCodeProbeError(VALIDATION_BODY, 403);
    expect(msg).toContain("VALIDATION_REQUIRED");
    expect(msg).toContain("https://accounts.google.com/signin/continue?sarp=1&scc=1");
    expect(msg).not.toContain('"@type"');
  });

  it("falls back to the parsed provider message for ordinary errors", () => {
    const body = JSON.stringify({ error: { message: "API key not valid" } });
    expect(buildCloudCodeProbeError(body, 400)).toBe("API key not valid");
  });

  it("falls back to the status line when the body is unreadable", () => {
    expect(buildCloudCodeProbeError("", 503)).toBe("API returned 503");
  });

  // 404 Requested entity was not found 在模型探测阶段不是服务端 bug，而是
  // 「这个账号的 rollout 还没放量到该模型」。裸文案会让人跑去查上游故障。
  it("rewrites a model-probe 404 into a rollout explanation naming the model", () => {
    const body = JSON.stringify({
      error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" },
    });
    const msg = buildCloudCodeProbeError(body, 404, "gemini-3.8-flash-high");
    expect(msg).toBe("Model not available on this account (Google preview/rollout not granted)");
    expect(msg).not.toContain("Requested entity was not found");
  });

  it("rewrites a credential-level 404 without naming a model", () => {
    const body = JSON.stringify({
      error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" },
    });
    const msg = buildCloudCodeProbeError(body, 404);
    expect(msg).toBe(
      "Requested resource not available on this account (Google preview/rollout not granted)",
    );
  });

  it("leaves non-404 errors untouched even when a model is targeted", () => {
    const body = JSON.stringify({ error: { message: "API key not valid" } });
    expect(buildCloudCodeProbeError(body, 400, "gemini-3.8-flash-high")).toBe("API key not valid");
  });
});

describe("extractAccountsVerificationUrl", () => {
  it("extracts the URL from the friendly chat error message", () => {
    const msg = "Google requires account verification (VALIDATION_REQUIRED). "
      + "Most often this means the account's 18+ age verification is missing — "
      + "complete it at https://myaccount.google.com/age-verification (check the birthdate at "
      + "https://myaccount.google.com/birthday first). "
      + 'Otherwise open this URL in a browser signed in to the affected account, complete "Verify your account", then retry: '
      + "https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/x&plt=T";
    expect(extractAccountsVerificationUrl(msg))
      .toBe("https://accounts.google.com/signin/continue?sarp=1&scc=1&continue=https://developers.google.com/x&plt=T");
  });

  it("extracts from a quoted JSON context and stops at the quote", () => {
    expect(extractAccountsVerificationUrl('{"validation_url":"https://accounts.google.com/signin/continue?plt=A"}'))
      .toBe("https://accounts.google.com/signin/continue?plt=A");
  });

  it("ignores non-verification Google URLs and non-strings", () => {
    expect(extractAccountsVerificationUrl("see https://myaccount.google.com/security")).toBeNull();
    expect(extractAccountsVerificationUrl(null)).toBeNull();
    expect(extractAccountsVerificationUrl(123)).toBeNull();
  });
});
