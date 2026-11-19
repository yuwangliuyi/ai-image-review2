import { identitySnapshot } from "@/lib/sso/identity-mapping";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, fail } from "@/lib/sso/errors";
import { requireOwnerSso } from "@/lib/sso/identity";
import { assertWizardState, buildContext } from "@/lib/sso/setup-context";
import {
  PHASES,
  audit,
  checkRevision,
  fingerprint,
  getState,
  refreshReview as refreshReviewTx,
  usersSnapshot,
} from "@/lib/sso/store";

export const dynamic = "force-dynamic";

/** 撤销本次（尚未完成的）映射：定向恢复快照前值，保留账号、角色和业务数据 */
export async function POST(req: NextRequest) {
  try {
    const owner = await requireOwnerSso(req);
    const body = (await req.json().catch(() => null)) as { revision?: unknown } | null;
    if (typeof body?.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0) {
      fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
    }
    const context = await prisma.$transaction(async (tx) => {
      const state = assertWizardState(await getState(tx));
      checkRevision(state, body!.revision as number, PHASES.ADMIN_VERIFICATION_REQUIRED);
      if (!state.rollbackAvailable) {
        fail(409, "STATE_CONFLICT", "已完成的历史映射只能由维护者定向处理，本阶段仅由负责人重新确认完成");
      }
      const users = await usersSnapshot(tx);
      if (state.mappedFingerprint !== fingerprint(users) || state.mappedIdentityFingerprint !== fingerprint(await identitySnapshot(tx, Object.keys(JSON.parse(state.snapshotJson || "{}"))))) {
        fail(409, "MAPPING_CONFLICT", "账号或角色已经变化，需要重新确认");
      }
      const snapshot = JSON.parse(state.snapshotJson || "{}") as Record<string, number | null>;
      // 先在同一事务内变更阶段，释放身份冻结
      await tx.ssoSetupState.update({ where: { id: 1 }, data: { phase: PHASES.MAPPING_REQUIRED } });
      for (const [localId, previousId] of Object.entries(snapshot)) {
        await tx.user.update({ where: { id: localId }, data: { ssoUserId: previousId } });
      }
      const identities = JSON.parse(state.identitySnapshotJson || "[]");
      await tx.ssoIdentityMapping.deleteMany({ where: { userId: { in: Object.keys(snapshot) } } });
      if (identities.length) await tx.ssoIdentityMapping.createMany({ data: identities });
      await tx.ssoSetupState.update({
        where: { id: 1 },
        data: {
          identitySnapshotJson: null,
          mappedIdentityFingerprint: null,
          revision: state.revision + 1,
          snapshotJson: null,
          mappedFingerprint: null,
          mappedUsersJson: null,
          rollbackAvailable: false,
          adminRevision: null,
          adminExpires: null,
        },
      });
      await refreshReviewTx(tx);
      await tx.ssoSetupDraft.deleteMany({});
      await audit(tx, "rollback-before-cutover", state.revision + 1, { ssoActorId: owner.identity.userId });
      return buildContext(tx, { viewerId: owner.identity.userId });
    });
    return Response.json(context, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "撤销本次关联失败");
  }
}
