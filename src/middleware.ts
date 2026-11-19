import { NextRequest, NextResponse } from "next/server";
import { authCookies } from "./lib/auth-cookies";

/**
 * 从请求头推导真实 origin（req.nextUrl.origin 在部分部署下会归一为 localhost）。
 */
function requestOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

/**
 * 阶段感知中间件：
 * - SSO_ONLY / 维护锁：直接放行，由客户端官方守卫引导中心登录、API 层拒绝旧会话；
 * - 准备阶段：未携带原会话 Cookie 的业务访问跳转 /login（仅导航 UX，
 *   真实鉴权由各 API 的身份层执行，因此这里不依赖密钥解密 JWT）。
 * 模式查询失败时按准备阶段处理（保持接入前行为）。
 */
const MODE_CACHE_TTL_MS = 5_000;
let modeCache: { phase: string; maintenanceLocked: boolean; expires: number } | null = null;

async function fetchMode(origin: string) {
  if (modeCache && modeCache.expires > Date.now()) return modeCache;
  try {
    const response = await fetch(`${origin}/api/auth/mode`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw new Error("mode unavailable");
    const mode = (await response.json()) as { phase?: string; maintenance_locked?: boolean };
    if (!mode.phase) throw new Error("invalid mode");
    modeCache = {
      phase: mode.phase,
      maintenanceLocked: mode.maintenance_locked === true,
      expires: Date.now() + MODE_CACHE_TTL_MS,
    };
    return modeCache;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const mode = await fetchMode(requestOrigin(req));
  if (mode && (mode.phase === "SSO_ONLY" || mode.maintenanceLocked)) {
    return NextResponse.next();
  }
  // 携带 SSO Bearer 的请求交给 API 身份层校验（SSO 失败不回退旧会话）
  const hasAuthorization = req.headers.has("authorization");
  const sessionName = authCookies().sessionToken.name;
  const hasSessionCookie = req.cookies.getAll().some(({ name }) =>
    name === sessionName || (name.startsWith(`${sessionName}.`) && /^\d+$/.test(name.slice(sessionName.length + 1))));
  if (!hasAuthorization && !hasSessionCookie) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/upload/:path*",
    "/review/:path*",
    "/archive/:path*",
    "/data-center/:path*",
    "/admin/:path*",
    "/notifications/:path*",
    "/api/images/:path*",
    "/api/spus/:path*",
    "/api/stats/:path*",
    "/api/users/:path*",
    "/api/archives/:path*",
    "/api/data-center/:path*",
    "/api/notifications/:path*",
  ],
};
