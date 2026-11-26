// CrowLLM (crowllm.com) — one-hub/new-api 系模型中转聚合站（2026-11-21 调研，
// 全部信息来自公开 /api/status、/api/pricing、/v1/models 与端点探测）。
//
// 形态：OpenAI 兼容网关（API 与站点同域 https://crowllm.com/v1/*），Bearer
// apiKey（sk- 前缀惯例）。站内货币 CC、one-api 倍率计价，`:free` 后缀即零倍率
// 免费模型。/v1/models 公开可拉（实测 2026-11-26：171 个模型、30 个 :free），
// 静态条目只锚定重点免费模型 + passthroughModels 透传动态全量。
//
// ⚠️ 2026-11-26 实测更正：真实 /v1/models（171 个）里 **没有 qwen4-max:free，
// 也没有 grok-4.7:free** —— 上游条目据 /api/pricing 锚定的这两个 id 已不存在。
// 免费目录实为 30 个 :free（glm-5.3-flash / deepseek-v4-flash-0731 /
// minimax-m3.1-flash / hy4-flash / step-5-preview / gemma-4-31b-it …），
// 锚定改为这六个实测存在的；其余靠 passthroughModels 动态跟随。
//
// 无签到/每日赠送机制（checkin_enabled=false，服务端开关下发）→ 不接每日任务
// 调度器。注册页带 Cloudflare Turnstile 人机验证，但 /api/* 与 /v1/* 接口当前
// 裸 curl 直通（服务端调用不受盾影响；CF 规则可能变，接入后要观测）。
//
// /v1/messages 端点存在（假 key 回鉴权错误而非 404）但官方 supported_endpoint
// 矩阵未列 anthropic → 暂按纯 OpenAI 协议接入，claude 协议面待真 key 实测。
//
// /console/token 是 one-hub 家族惯例 key 页路径（SPA 无法无浏览器渲染验证，
// 未实锤）。aff=emqU 是用户主号的邀请码。
export default {
  id: "crowllm",
  priority: 34,
  alias: "crowllm",
  uiAlias: "crowllm",
  display: {
    name: "CrowLLM",
    icon: "api",
    color: "#2563eb",
    website: "https://crowllm.com",
    notice: {
      text: "CrowLLM is an OpenAI-compatible gateway (one-hub family) with 180+ models; models suffixed :free cost nothing. Register with email/Google/GitHub/Discord, then create a key in the console.",
      signupUrl: "https://crowllm.com/sign-up?aff=emqU",
      apiKeyUrl: "https://crowllm.com/console/token",
    },
  },
  // 免费额度组（free + freeTier 合并渲染成「免费」列表）——apikey 接入 +
  // :free 零倍率模型正是 freeTier 语义（deepai/dots/api-airforce 同组）。
  category: "freeTier",
  authModes: ["apikey"],
  authType: "apikey",
  transport: {
    baseUrl: "https://crowllm.com/v1/chat/completions",
    validateUrl: "https://crowllm.com/v1/models",
    headers: {},
    timeoutMs: 120000,
  },
  modelsFetcher: { url: "https://crowllm.com/v1/models", type: "openai" },
  passthroughModels: true,
  // 2026-11-26 实测（本机直连不通，按记忆里的经验走 192.168.5.2:7894 代理拉
  // /v1/models，http=200）：目录共 171 个模型，其中 **30 个 :free**。上游条目
  // 里锚定的 qwen4-max:free / grok-4.7:free 在真实目录里**不存在**（全目录都没
  // 这两个 id，grok 只到 4.7 无 :free 版），已替换为实测存在的 four。
  models: [
    { id: "glm-5.3-flash:free", name: "GLM 5.3 Flash (Free)" },
    { id: "deepseek-v4-flash-0731:free", name: "DeepSeek V4 Flash 0731 (Free)" },
    { id: "minimax-m3.1-flash:free", name: "MiniMax M3.1 Flash (Free)" },
    { id: "hy4-flash:free", name: "HY4 Flash (Free)" },
    { id: "step-5-preview:free", name: "Step 5 Preview (Free)" },
    { id: "gemma-4-31b-it:free", name: "Gemma 4 31B (Free)" },
  ],
};