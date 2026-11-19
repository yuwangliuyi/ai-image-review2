import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 佳选 SSO 接入包为官方参考材料，不属于本项目源码
    "jx-sso-integration/**",
    // SSO 合同测试使用模拟对象，允许 any
    "tests/**",
  ]),
]);

export default eslintConfig;
