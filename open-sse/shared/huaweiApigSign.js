/**
 * 华为云 APIG `SDK-HMAC-SHA256` 签名器。
 *
 * 依据：华为云官方《API签名指南》(support.huaweicloud.com/devg-apisign/) 的四段式
 * canonical request；并与 CodeArts Agent 客户端内 huaweicloud-sdk-core 的 Signer
 * 行为逐步对拍过。纯函数、无 IO，可直接单测。
 *
 * 实测校验方式（2026-10-30）：拿华为网关做对照实验 ——
 *   - SK 改一位 → `401 APIG.0301 verify ak sk signature fail`
 *   - AK 乱填   → `401 APIG.0301 access key ... is not found`
 *   - 正确三元组 → 业务层错误码（说明网关已验签通过）
 * 三条同时成立才说明签名实现是对的，缺一条都只是「看起来能跑」。
 *
 * 两个容易踩错的点：
 *  1. `PayloadHash` 取的是 **已序列化字符串** 的 sha256，不是对象、不是原始字节。
 *     调用方必须固定同一份字符串既用于签名又用于发送，否则签名必错。
 *  2. `CanonicalURI` 每一段都要按华为规则编码（`~` 之外的非 unreserved 全部百分号
 *     编码，大写），并且结果若不以 `/` 结尾要补一个。少了这个补斜杠，
 *     网关会报签名不匹配而不是路径错误，非常难排查。
 *
 * @module huaweicloud-apig-sign
 */

import { createHash, createHmac } from "node:crypto";

/** 空 body 的 sha256。 */
export const EMPTY_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const ALGORITHM = "SDK-HMAC-SHA256";

/**
 * 华为 SDK 的 URI 编码：仅保留 `A-Za-z0-9-_.~`，其余一律 `%XX`（大写）。
 * encodeURIComponent 不编码 `!'()*`，而华为要求编码它们。
 *
 * @param {string} value
 * @returns {string}
 */
export function huaweiEncode(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * CanonicalURI：按段编码后拼回，并以 `/` 结尾。
 *
 * @param {string} pathname
 * @returns {string}
 */
export function canonicalUri(pathname) {
  const path = pathname && pathname.length > 0 ? pathname : "/";
  const encoded = path.split("/").map(huaweiEncode).join("/");
  return encoded.endsWith("/") ? encoded : `${encoded}/`;
}

/**
 * CanonicalQueryString：按参数名排序，键值都做华为编码，`&` 连接。
 * 空 query 返回空串（canonical request 里该行保留为空行）。
 *
 * @param {string} [search]  含前导 `?` 或不含均可
 * @returns {string}
 */
export function canonicalQuery(search) {
  const q = (search || "").replace(/^\?/, "");
  if (!q) return "";
  return q
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      const rawKey = idx === -1 ? pair : pair.slice(0, idx);
      const rawVal = idx === -1 ? "" : pair.slice(idx + 1);
      // 先解码再重编码，避免已编码的值被二次编码
      const decode = (s) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, " "));
        } catch {
          return s;
        }
      };
      return `${huaweiEncode(decode(rawKey))}=${huaweiEncode(decode(rawVal))}`;
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join("&");
}

/**
 * `YYYYMMDDTHHmmssZ`（UTC）。
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function sdkDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * @param {string} text
 * @returns {string}
 */
export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 对请求签名。
 *
 * @param {object} options
 * @param {string} options.method        HTTP 方法，大小写不敏感
 * @param {string} options.url           完整 URL（含 query）
 * @param {Record<string,string>} [options.headers]  需要一并签名的业务头（不含 host / X-Sdk-Date / X-Security-Token，这三个自动加）
 * @param {string} [options.bodyText]    已序列化好的请求体字符串；GET 传 undefined
 * @param {string} options.accessKey
 * @param {string} options.secretKey
 * @param {string} [options.securityToken]  临时 STS；有则自动加 `X-Security-Token` 并参与签名
 * @param {Date}   [options.now]         注入时间便于测试
 * @returns {{
 *   headers: Record<string,string>,
 *   authorization: string,
 *   signedHeaders: string,
 *   payloadHash: string,
 *   canonicalRequest: string,
 *   stringToSign: string
 * }}
 */
export function signRequest(options) {
  const { method, url, accessKey, secretKey, securityToken, bodyText, now } = options;

  const parsed = new URL(url);
  const headers = {};
  for (const [name, value] of Object.entries(options.headers || {})) {
    if (value === undefined || value === null) continue;
    headers[name] = String(value);
  }
  headers.host = parsed.host;
  headers["X-Sdk-Date"] = sdkDate(now);
  if (typeof securityToken === "string" && securityToken.length > 0) {
    headers["X-Security-Token"] = securityToken;
  }

  // 规范化头：按小写名排序，值做 trim + 连续空白折叠
  const sortedLower = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const originalByLower = new Map(
    Object.keys(headers).map((name) => [name.toLowerCase(), name])
  );
  const canonicalHeaders = sortedLower
    .map((lower) => {
      const original = originalByLower.get(lower);
      const value = original === undefined ? "" : headers[original];
      return `${lower}:${String(value).trim().replace(/\s+/g, " ")}\n`;
    })
    .join("");

  const signedHeaders = sortedLower.join(";");
  const payloadHash =
    typeof bodyText === "string" ? sha256Hex(bodyText) : EMPTY_BODY_SHA256;

  const canonicalRequest = [
    String(method).toUpperCase(),
    canonicalUri(parsed.pathname),
    canonicalQuery(parsed.search),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = `${ALGORITHM}\n${headers["X-Sdk-Date"]}\n${sha256Hex(canonicalRequest)}`;
  const signature = createHmac("sha256", secretKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `${ALGORITHM} Access=${accessKey}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers,
    authorization,
    signedHeaders,
    payloadHash,
    canonicalRequest,
    stringToSign,
  };
}

/**
 * 便捷封装：返回可直接用于 fetch 的 headers（含 Authorization）。
 *
 * @param {object} options  同 signRequest
 * @returns {Record<string,string>}
 */
export function signedHeaders(options) {
  const { headers, authorization } = signRequest(options);
  return { ...headers, Authorization: authorization };
}
