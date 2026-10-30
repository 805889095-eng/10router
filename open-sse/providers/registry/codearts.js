/**
 * 华为云 CodeArts（码道）桌面端额度通道。
 *
 * 这家的凭据不是单个 API Key，而是「AccessKey + SecretKey + SecurityToken(临时 STS)」
 * 三元组，且每个请求都要按华为 APIG 规范重新做 `SDK-HMAC-SHA256` 签名。
 *
 * 为了不改动前端表单，凭据用一个字段传入，三段用 `|` 分隔：
 *
 *     AK|SK|STS
 *
 * 例：
 *     HSTA86B1IUP7KIQGZD01|28XPSA...R6A5|hQpjbi...
 *
 * 也支持更规范的写法：apiKey 填 AK，providerSpecificData.secretKey 填 SK，
 * accessToken 填 STS —— executor 两种都认，优先用分开的字段。
 *
 * ⚠️ STS 有效期约 1.8 小时，过期后网关返回 401 APIG.0301。
 *    过期前重新从 CodeArts 客户端导出一次三元组即可；客户端自身会静默续期，
 *    因此只要客户端保持登录，重新导出总能拿到新的 STS。
 */
export default {
  id: "codearts",
  priority: 118,
  alias: "ca",
  display: {
    name: "华为云 CodeArts（码道）",
    icon: "auto_awesome",
    color: "#C7000B",
    textIcon: "HW",
    website: "https://codearts.huaweicloud.com/",
    notice: {
      // 让用户知道去哪拿这三段
      signupUrl: "https://codearts.huaweicloud.com/download.html#section-8",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  transport: {
    baseUrl: "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions",
    thinkingFormat: "openai",
    headers: {},
  },
  models: [
    // 以下 10 个模型于 2026-10-30 逐个发真实请求验证可用（HTTP 200 + choices），
    // 不是照抄文档清单。
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash 1017" },
    { id: "GLM-5.2", name: "GLM 5.2" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.2-sft-harmony", name: "GLM 5.2 ArkTS SPARK" },
    { id: "openpangu-2.0-flash", name: "openPangu 2.0 Flash (92B)" },
    { id: "openpangu-2.0-pro", name: "openPangu 2.0 Pro (505B)" },
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "Qwen3-VL-235B", name: "Qwen3 VL 235B" },
    { id: "kimi-k2.6-vl", name: "Kimi K2.6 VL" },
  ],
};
