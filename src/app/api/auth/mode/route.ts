import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { modeView } from "@/lib/sso/setup-context";
import { handleApiError } from "@/lib/sso/errors";
import { getState } from "@/lib/sso/store";

export const dynamic = "force-dynamic";

/** 公开模式接口：阶段、版本与公开 SSO 配置；无用户信息，禁止缓存 */
export async function GET() {
  try {
    const state = await prisma.$transaction(async (tx) => getState(tx));
    return NextResponse.json(
      modeView(state),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error, "获取登录模式失败");
  }
}
