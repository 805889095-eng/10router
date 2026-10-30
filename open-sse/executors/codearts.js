import { createHash } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { signedHeaders } from "../shared/huaweiApigSign.js";

/**
 * 华为云 CodeArts（码道）桌面端额度通道。
 *
 * 端点与鉴权全部从官方客户端 `huaweicloud.codearts-snap` 26.10.100 里实测得到，
 * 不是文档推测：
 *
 *   推理   POST https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions
 *   模型   GET  https://snap-access.cn-north-4.myhuaweicloud.com/v1/model/builtin
 *          （必须带 `Agent-Type` 头，否则 `TM.00001001 请求头Agent-Type为空`）
 *
 * 鉴权不是 Bearer，而是华为 APIG 的 `SDK-HMAC-SHA256`：
 *   Authorization: SDK-HMAC-SHA256 Access=<AK>, SignedHeaders=..., Signature=...
 *   X-Sdk-Date: <UTC 时间戳>
 *   X-Security-Token: <客户端登录拿到的临时 STS>
 *
 * 三元组来源说明（重要）：
 *   AK/SK/STS 是客户端登录后下发的一次性凭据，AK/SK 长期、STS 约 1.8 小时过期。
 *   STS 到期后网关会返回 401 `APIG.0301`，此时必须重新从客户端取一份新的。
 *   续期接口走 IAM OAuth2 + DPoP + PKCE（需要客户端 loginContext 里的 EC 私钥
 *   现签 JWT proof），网关侧无法可靠复刻 —— 因此这里的策略是：
 *   只要客户端保持登录（它自己每小时静默续期），外部定期重新导出三元组即可。
 *   凭据过期时给出明确可读的错误，而不是让上游 401 直奔用户。
 *
 * 凭据字段映射（复用 10Router 的 connection 字段，避免改动数据库 schema）：
 *   apiKey                          → AccessKeyID
 *   accessToken                     → SecurityToken（临时 STS）
 *   providerSpecificData.secretKey  → SecretAccessKey
 *   providerSpecificData.expiresAt  → 可选，ISO 时间，用于提前提示过期
 */
export class CodeArtsExecutor extends BaseExecutor {
  constructor() {
    super("codearts", PROVIDERS.codearts);
  }

  /**
   * 请求体就是标准 OpenAI chat.completions，不需要转换。
   * 只有一点：别名模型（如 deepseek-v4.1-flash-1017）原样透传 —— 该网关
   * 自己维护 model_id 大小写，做归一化反而会 404 `Route missed for model`。
   */
  transformRequest(model, body, stream) {
    return body;
  }

  /**
   * @param {object} credentials
   * @param {boolean} stream
   * @param {string} url            最终要请求的 URL（含 query），签名的 CanonicalURI 必须取自它
   * @param {string} model
   * @param {object} transformedBody 与 base 发送的 body 是同一个对象
   */
  buildHeaders(credentials, stream = true, url, model, transformedBody) {
    const { accessKey, secretKey, securityToken } = resolveCodeArtsCredentials(credentials);

    if (!accessKey || !secretKey || !securityToken) {
      throw new Error(
        "CodeArts 凭据不完整：需要 AccessKey + SecretKey + SecurityToken。"
        + "单字段写法为 API Key 填 `AK|SK|STS`；也可分开放（apiKey / providerSpecificData.secretKey / accessToken）。"
      );
    }

    // 会话级稳定 id：同一会话内 Chat-Id/Session-Id 必须一致，否则上游每次
    // 都按新会话计费与限流；换会话才换 id。
    //
    // 注意不能只用 resolveSessionId() 的结果：它在拿不到客户端会话头、也没有
    // connectionId 时会退化成每次不同的值，那样每一轮都成了新会话。这里以
    // 「连接 id + 会话首条 user 消息」为特征做哈希 —— 首条消息在一个会话里
    // 始终不变，因此天然稳定；换会话（首条消息变）才换 id。
    // 只用确定性输入（connectionId + 首条 user 消息）派生，绝不掺入任何可能
    // 随机的中间值 —— 掺一次就等于每轮换会话。
    const chatId = stableHexId(
      `${credentials?.connectionId || ""}|${conversationKey(transformedBody)}`,
      32
    );

    // ⚠️ 必须和 base.js:148 的 JSON.stringify(transformedBody) 完全同源，
    // 否则 PayloadHash 对不上、网关报签名不匹配（而不是报 body 错）。
    const bodyText = transformedBody ? JSON.stringify(transformedBody) : undefined;

    return signedHeaders({
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
        // 该网关按 Agent-Type 分流；缺了模型清单接口直接 400
        "Agent-Type": "PromptCenter",
        "Chat-Id": chatId,
        "Session-Id": chatId,
      },
      bodyText,
      accessKey,
      secretKey,
      securityToken,
    });
  }
}

/**
 * 由会话键派生稳定的 32 位十六进制 id。
 * @param {string} key
 * @param {number} len
 * @returns {string}
 */
function stableHexId(key, len = 32) {
  return createHash("sha256").update(String(key)).digest("hex").slice(0, len);
}

/**
 * 解析三元组凭据。两种写法都支持：
 *  1. 单字段：apiKey = `AK|SK|STS`
 *  2. 分开：apiKey=AK, providerSpecificData.secretKey=SK, accessToken=STS
 *
 * 单字段写法是为了不改前端表单 —— 任何能填「API Key」的入口都能用。
 *
 * @param {object} credentials
 * @returns {{accessKey: string, secretKey: string, securityToken: string}}
 */
export function resolveCodeArtsCredentials(credentials) {
  const psd = credentials?.providerSpecificData || {};
  let accessKey = credentials?.apiKey || credentials?.accessKey || "";
  let secretKey = psd.secretKey || credentials?.secretKey || "";
  // 客户端原样字段名是全小写的 securitytoken，这里一并认
  let securityToken =
    credentials?.accessToken || psd.securityToken || psd.securitytoken || "";

  if (typeof accessKey === "string" && accessKey.includes("|")) {
    const parts = accessKey.split("|");
    if (parts.length >= 3) {
      accessKey = parts[0];
      secretKey = parts[1];
      // STS 自身理论上不含 `|`，但仍然把剩余部分整体拼回，避免误截断
      securityToken = parts.slice(2).join("|");
    }
  }

  const trim = (v) => (typeof v === "string" ? v.trim() : "");
  return {
    accessKey: trim(accessKey),
    secretKey: trim(secretKey),
    securityToken: trim(securityToken),
  };
}

/**
 * 会话特征：取首条 user 消息文本（截断），用于派生稳定的会话 id。
 * 同一会话里首条消息不变，因此 id 稳定；新会话首条消息不同 → id 自然变化。
 *
 * @param {object} body
 * @returns {string}
 */
function conversationKey(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const first = msgs.find((m) => m?.role === "user");
  if (!first) return "no-user-message";
  const content = first.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("")
        : JSON.stringify(content ?? "");
  return text.slice(0, 2000);
}
