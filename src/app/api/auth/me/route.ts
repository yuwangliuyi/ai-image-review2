import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/sso/identity";
import { handleApiError } from "@/lib/sso/errors";

export const dynamic = "force-dynamic";

/**
 * 当前身份：有 Bearer 时仅验证 SSO（任何失败不回退旧会话）；
 * 无 Bearer 时返回原会话身份。
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    return NextResponse.json(
      {
        ...actor.publicUser,
        auth_method: actor.authMethod,
        is_pending: actor.isPending,
        is_global_super_admin: actor.isGlobalSuperAdmin,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error, "读取当前身份失败");
  }
}
