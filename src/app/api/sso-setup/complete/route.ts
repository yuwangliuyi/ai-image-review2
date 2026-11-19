import { findIdentityUser, identitySnapshot } from "@/lib/sso/identity-mapping";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, fail } from "@/lib/sso/errors";
import { requireOwnerSso, sameOrigin } from "@/lib/sso/identity";
import { assertWizardState, buildContext, requireRosterUser } from "@/lib/sso/setup-context";
import {
  PHASES,
  audit,
  checkRevision,
  fingerprint,
  getState,
  usersSnapshot,
} from "@/lib/sso/store";

export const dynamic = "force-dynamic";

/**
 * 负责人完成切换：
 * 事务中重查完整快照、至少一名启用旧管理员非空关联、所有映射的最新准入，
 * 原子更新阶段、关闭旧登录并启用 JIT。旧 NextAuth JWT 无法服务端吊销，
 * 由 SSO_ONLY 下所有接口拒绝旧会话保证等效失效，并在此清除本浏览器 Cookie。
 */
export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    const owner = await requireOwnerSso(req);
    const roster = await owner.client.roster(owner.token);
    const body = (await req.json().catch(() => null)) as { revision?: unknown } | null;
    if (typeof body?.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0) {
      fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
    }
    const context = await prisma.$transaction(async (tx) => {
      const state = assertWizardState(await getState(tx));
      checkRevision(state, body!.revision as number, PHASES.ADMIN_VERIFICATION_REQUIRED);
      const users = await usersSnapshot(tx);
      if (state.mappedFingerprint !== fingerprint(users) || state.mappedIdentityFingerprint !== fingerprint(await identitySnapshot(tx, Object.keys(JSON.parse(state.snapshotJson || "{}"))))) {
        fail(409, "MAPPING_CONFLICT", "账号或角色已经变化，需要重新确认");
      }
      if (!users.some((user) => user.is_admin && user.is_enabled && user.sso_user_id !== null)) {
        fail(409, "ADMIN_MAPPING_REQUIRED", "至少关联一名启用的原管理员才能完成接入");
      }
      for (const user of users) {
        if (user.sso_user_id !== null) {
          const person = requireRosterUser(roster, user.sso_user_id);
          const mapped = await findIdentityUser(tx, state, owner.settings.ssoApiUrl, {
            userId: person.user_id, username: person.username, name: person.name,
            dingCorpId: person.ding_corp_id, dingUserId: person.ding_user_id, isApplicationOwner: false, isGlobalSuperAdmin: false,
          });
          if (!mapped || mapped.id !== user.local_user_id) fail(409, "MAPPING_CONFLICT", "公司人员身份已经变化，请重新核对关联");
        }
      }
      await tx.ssoSetupState.update({
        where: { id: 1 },
        data: { phase: PHASES.SSO_ONLY, revision: state.revision + 1, rollbackAvailable: false },
      });
      await tx.ssoSetupDraft.deleteMany({});
      await audit(tx, "complete", state.revision + 1, { ssoActorId: owner.identity.userId });
      return buildContext(tx, { roster, viewerId: owner.identity.userId });
    });
    const response = NextResponse.json(context, { headers: { "Cache-Control": "no-store" } });
    // 撤销本浏览器旧会话：删除 NextAuth Cookie（服务端拒绝由阶段检查保证）
    for (const name of ["next-auth.session-token", "next-auth.csrf-token", "__Secure-next-auth.session-token"]) {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
    return response;
  } catch (error) {
    return handleApiError(error, "完成接入失败");
  }
}
