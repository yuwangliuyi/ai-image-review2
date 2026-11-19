/**
 * 佳选 SSO guided 接入配置。dingtalk-v1 负责人以当前中心 verify 为准；
 * 旧 JX_SSO_OWNER_USER_ID 仅兼容配置，不参与新协议授权。
 */

const APP_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

export interface SsoSettings {
  appId: string;
  ssoWebUrl: string;
  ssoApiUrl: string;
  ownerUserId: number;
  environment: "local" | "test" | "prod";
}

function parseRootUrl(value: string, field: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${field} 必须是完整的 HTTP/HTTPS 地址`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${field} 只允许 HTTP/HTTPS`)
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${field} 不能包含账号、参数或 Fragment`)
  }
  // 允许根路径前缀（如 SSO API 的 /sso），仅去除末尾斜杠
  return parsed.href.replace(/\/+$/, "")
}

export function readSsoSettings(): SsoSettings {
  if (process.env.JX_SSO_ONBOARDING_MODE !== "guided") {
    throw new Error("此实现仅接受 JX_SSO_ONBOARDING_MODE=guided");
  }
  if ("JX_SSO_JIT_PROVISIONING_ENABLED" in process.env) {
    throw new Error("guided 与旧 JX_SSO_JIT_PROVISIONING_ENABLED 配置互斥");
  }
  const appId = (process.env.JX_SSO_APP_ID || "").trim();
  if (!APP_ID_PATTERN.test(appId)) {
    throw new Error("JX_SSO_APP_ID 不合法");
  }
  const ownerUserId = Number(process.env.JX_SSO_OWNER_USER_ID || 0);
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId < 0) {
    throw new Error("JX_SSO_OWNER_USER_ID 如设置必须是非负整数");
  }
  const environment = process.env.JX_SSO_ENVIRONMENT;
  if (environment !== "local" && environment !== "test" && environment !== "prod") {
    throw new Error("JX_SSO_ENVIRONMENT 仅允许 local/test/prod");
  }
  const settings: SsoSettings = {
    appId,
    ssoWebUrl: parseRootUrl((process.env.JX_SSO_WEB_URL || "").trim(), "JX_SSO_WEB_URL"),
    ssoApiUrl: parseRootUrl((process.env.JX_SSO_API_URL || "").trim(), "JX_SSO_API_URL"),
    ownerUserId,
    environment,
  };
  if (settings.environment === "prod") {
    for (const url of [settings.ssoWebUrl, settings.ssoApiUrl]) {
      if (!url.startsWith("https://")) {
        throw new Error("正式环境 SSO 地址必须使用 HTTPS");
      }
    }
  }
  return settings;
}
