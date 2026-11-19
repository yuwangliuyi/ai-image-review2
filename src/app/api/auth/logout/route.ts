import { NextRequest, NextResponse } from "next/server";
import { getActor, getBearer, sameOrigin, ssoClient } from "@/lib/sso/identity";
import { handleApiError, SsoError } from "@/lib/sso/errors";
import { authCookies, ownedCookieNames } from "@/lib/auth-cookies";

export const dynamic = "force-dynamic";

function clearLegacyCookies(req: NextRequest, response: NextResponse): void {
  for (const name of ownedCookieNames(req.cookies.getAll().map(cookie => cookie.name))) {
    response.cookies.set(name, "", { ...authCookies().sessionToken.options, maxAge: 0 });
  }
}

/**
 * 统一退出：
 * - SSO 身份携当前子 Token 向中心 POST /auth/logout（{"app_id","scope":"all"}），
 *   撤销该账号所有设备凭据；确定失效（401）按幂等本地清理处理；
 * - 原本地身份仅本地退出；主动退出后不能触发自动登录（由前端退出标记保证）。
 */
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    if (req.headers.has("authorization")) {
      try {
        const token = getBearer(req);
        await ssoClient().logout(token);
      } catch (error) {
        // 401 = 凭据已失效：仅完成本地清理；403/5xx/网络错误保留状态供重试
        if (!(error instanceof SsoError) || error.status !== 401) throw error;
      }
    } else {
      // 原本地身份退出：要求会话仍有效，防止跨站强制退出
      await getActor(req);
    }
    const response = NextResponse.json(
      { message: "已退出" },
      { headers: { "Cache-Control": "no-store" } }
    );
    clearLegacyCookies(req, response);
    return response;
  } catch (error) {
    return handleApiError(error, "退出失败");
  }
}
