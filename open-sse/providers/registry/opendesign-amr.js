// OpenDesign (open-design.ai) — AMR (Agentic Model Router) 托管网关。
//
// 与仓库里既有的 `opendesign`（manalkaff/opendesign，Claude Code 的 skills/plugin 包）
// 完全不是一个东西，切勿混用：那个是"装在宿主 Agent 里的设计技能包"，本身不提供
// 任何模型端点；本文件接入的是 open-design.ai 官网发行的 Design Plan 套餐额度网关
// `amr-link.open-design.ai`，讲标准 OpenAI Chat Completions 协议。
//
// 计费模型与常见按量付费 API 不同：API Key（sk-amr-…）不单独计费，直接消耗
// open-design.ai 账号的 Design Plan 月度额度。额度用完即 429，与套餐卡片的
// "每月最高总额度" 共用同一份配额。
//
// 网关自带 /v1/models，返回每个模型的 context_limit / output_budget / cost /
// 输入模态，因此用 modelsFetcher 动态拉取，不做本地硬编码（官方随时加模型，
// 硬编码会立刻过期）。

export default {
  id: "opendesign-amr",
  priority: 78,
  alias: "opendesign-amr",
  aliases: [
    "oda",
    "od-amr",
    "amr",
    "open-design",
  ],
  uiAlias: "oda",
  display: {
    name: "OpenDesign (AMR)",
    icon: "palette",
    color: "#111827",
    textIcon: "OD",
    website: "https://open-design.ai",
    notice: {
      apiKeyUrl: "https://open-design.ai/zh/pricing/",
      // API 与设计 Agent 共用同一份 Design Plan 额度，不单独计费。
      kindNotice: {
        image: "消耗 open-design.ai 的 Design Plan 月度额度，非常规按量计费。",
      },
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://amr-link.open-design.ai/v1/chat/completions",
    validateUrl: "https://amr-link.open-design.ai/v1/models",
    // 官方网关在境外（美东），国内直连不稳，走代理。
    strictProxy: true,
    // 动态模型列表：不需要手写 models 数组，网关自报 context/output/模态。
    modelsFetcher: {
      url: "https://amr-link.open-design.ai/v1/models",
      type: "openai",
    },
  },
  // 静态兜底列表：modelsFetcher 拉取失败时（离线 / 未配 Key）UI 仍有可选项。
  // 顺序与内容对齐 2026-10 实测的 /v1/models 结果。
  models: [
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (Exp)" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "glm-5.3-flashx", name: "GLM 5.3 FlashX" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
    { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
    { id: "minimax-m3.1-flash", name: "MiniMax M3.1 Flash" },
    { id: "hy4-preview", name: "Hunyuan H4 Preview" },
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
    { id: "claude-haiku-5.5", name: "Claude Haiku 5.5" },
  ],
  features: {
    usage: true,
  },
};
