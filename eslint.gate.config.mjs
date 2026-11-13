import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "@typescript-eslint/eslint-plugin";
import nextPlugin from "@next/eslint-plugin-next";
import react from "eslint-plugin-react";
import importPlugin from "eslint-plugin-import";

// 「客户端白屏」专用门禁配置。
//
// 为什么单开一份而不是直接用 eslint.config.mjs：
// 项目主配置继承 eslint-config-next，全量跑有 145 条既有 error（react-hooks
// 系列为主），历史欠账太重，直接拿它做 CI 门禁必然长红。这份配置只放一条
// 判定规则 —— no-undef，专治「服务端 SSR 200、客户端 hydrate 抛
// ReferenceError」这类静默白屏（v1.9.8 Loomy 页事故：三个未定义标识符过了
// 单测、过了 build，只在浏览器 parse chunk 时才炸）。
//
// 插件是按「已注册但规则全关」挂进来的：源码里那些
// `// eslint-disable-next-line react-hooks/xxx` 注释一旦找不到规则定义，
// ESLint 9 会直接报 "Definition for rule ... was not found"，把门禁染红。
// 挂上空壳插件即可让这些注释静默，同时不引入任何一条它们的规则。
//
// 用法：npx eslint --config eslint.gate.config.mjs src/
// 加规则前先确认基线干净 —— 别把假阳性带进门禁。
//
// 注意：**不要**把 no-undef 放开到 .ts/.tsx —— TS 由 tsc 管，eslint 的
// no-undef 对类型空间无感知，会大面积误报。本仓当前无 TS 源文件。
export default [
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/out/**",
      "**/build/**",
      "**/*.config.{js,mjs,cjs}",
      "scripts/**",
      "tests/**",
      "desktop/**",
      "cli/**",
    ],
    plugins: {
      "react-hooks": reactHooks,
      "@typescript-eslint": tseslint,
      "@next/next": nextPlugin,
      react,
      import: importPlugin,
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    // 插件只挂不启规则，源码里针对这些规则的 eslint-disable 注释自然成了
    // 「未使用」（规则没开就没什么可禁的）。那是噪声，不是问题 —— 关掉这条
    // 报告，门禁输出只留真正想拦的东西。
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      "no-undef": "error",
    },
  },
];
