import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/sso/errors";
import { requireOwnerSso } from "@/lib/sso/identity";
import { assertWizardState, buildContext, refreshReviewTx } from "@/lib/sso/setup-context";
import { getState } from "@/lib/sso/store";

export const dynamic = "force-dynamic";

/** 恢复状态、账号、完整最新名单及草稿（负责人 SSO） */
export async function GET(req: NextRequest) {
  try {
    const owner = await requireOwnerSso(req);
    const roster = await owner.client.roster(owner.token);
    // MAPPING_REQUIRED 下账号资料变化时递增版本，使旧草稿/页面重新核对
    const context = await prisma.$transaction(async (tx) => {
      assertWizardState(await getState(tx));
      await refreshReviewTx(tx);
      return buildContext(tx, { roster, viewerId: owner.identity.userId });
    });
    return Response.json(context, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "读取接入状态失败");
  }
}
