import { bindIdentity, identitySnapshot } from "@/lib/sso/identity-mapping";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, fail } from "@/lib/sso/errors";
import { requireOwnerSso } from "@/lib/sso/identity";
import { phoneSuggestions } from "@/lib/sso/phone";
import { assertWizardState, buildContext, requireRosterUser } from "@/lib/sso/setup-context";
import {
  PHASES,
  audit,
  checkRevision,
  draftRows,
  fingerprint,
  getState,
  publicUser,
  phoneValuesFor,
  reviewFingerprint,
  userOrderBy,
  usersSnapshot,
} from "@/lib/sso/store";

export const dynamic = "force-dynamic";

interface MappingRowInput {
  local_user_id: string;
  sso_user_id: number | null;
  confirmed: boolean;
  selection_source: "manual" | "phone";
}

function parseBody(body: unknown): { revision: number; allowUnmapped: boolean; rows: MappingRowInput[] } {
  if (typeof body !== "object" || body === null) {
    fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
  }
  const raw = body as Record<string, unknown>;
  if (typeof raw.revision !== "number" || !Array.isArray(raw.rows)) {
    fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
  }
  const allowUnmapped = raw.allow_unmapped === true;
  const rows = (raw.rows as Record<string, unknown>[]).map((row) => {
    if (
      typeof row.local_user_id !== "string" ||
      !row.local_user_id ||
      row.local_user_id.length > 128 ||
      row.confirmed !== true
    ) {
      // confirmed=true 只能由整批“确认并同步关联”动作构造
      fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
    }
    if (row.sso_user_id !== null && row.sso_user_id !== undefined) {
      if (typeof row.sso_user_id !== "number" || !Number.isSafeInteger(row.sso_user_id) || row.sso_user_id <= 0) {
        fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
      }
    }
    return {
      local_user_id: row.local_user_id,
      sso_user_id: (row.sso_user_id as number) ?? null,
      confirmed: true as const,
      selection_source: (row.selection_source === "phone" ? "phone" : "manual") as "manual" | "phone",
    };
  });
  return { revision: raw.revision, allowUnmapped, rows };
}

/**
 * 整批确认映射：
 * - 完整旧账号集合，null 表示显式留空（须 allow_unmapped=true）；
 * - 已有关联不可覆盖；至少一名启用旧管理员非空关联；
 * - phone 来源提交时实时复查；事务内写入并转入待负责人完成阶段。
 */
export async function POST(req: NextRequest) {
  try {
    const owner = await requireOwnerSso(req);
    const roster = await owner.client.roster(owner.token);
    requireRosterUser(roster, owner.identity.userId);
    const payload = parseBody(await req.json().catch(() => null));

    const phoneRows = payload.rows.filter(
      (row) => row.selection_source === "phone" && row.sso_user_id !== null
    );
    let matched = new Map<string, number>();
    if (phoneRows.length > 0) {
      await prisma.$transaction(async (tx) => {
        const state = assertWizardState(await getState(tx));
        checkRevision(state, payload.revision, PHASES.MAPPING_REQUIRED);
        if (state.reviewFingerprint !== (await reviewFingerprint(tx))) {
          fail(409, "REVISION_CONFLICT", "原账号资料已经变化，请刷新并重新确认");
        }
        for (const row of phoneRows) {
          const draft = await tx.ssoSetupDraft.findUnique({ where: { localId: row.local_user_id } });
          if (draft && draft.phoneFingerprint !== fingerprint(null)) {
            fail(409, "MAPPING_CONFLICT", "草稿手机号已经变化，请重新推荐或手动确认");
          }
        }
      });
      const users = await usersSnapshot(prisma);
      const phones = phoneValuesFor(users);
      const suggestions = await phoneSuggestions(owner.client, owner.token, users, phones, payload.rows);
      matched = new Map(
        suggestions
          .filter((item) => item.candidate)
          .map((item) => [item.local_user_id, item.candidate!.user_id])
      );
    }

    const context = await prisma.$transaction(async (tx) => {
      const state = assertWizardState(await getState(tx));
      checkRevision(state, payload.revision, PHASES.MAPPING_REQUIRED);
      const localUsers = await usersSnapshot(tx);
      if (state.reviewFingerprint !== (await reviewFingerprint(tx))) {
        fail(409, "REVISION_CONFLICT", "账号或角色已经变化，请刷新并重新确认全部账号");
      }
      const draft = await draftRows(tx);
      if (draft.some((row) => row.stale)) {
        fail(409, "MAPPING_CONFLICT", "草稿对应的原账号资料已经变化，请核对后重新保存草稿");
      }
      const localById = new Map(localUsers.map((user) => [user.local_user_id, user]));
      const selected = new Map(payload.rows.map((row) => [row.local_user_id, row.sso_user_id]));
      const nonEmpty = [...selected.values()].filter((id) => id !== null) as number[];
      if (
        selected.size === 0 ||
        selected.size !== payload.rows.length ||
        new Set(localById.keys()).size !== selected.size ||
        !localUsers.every((user) => selected.has(user.local_user_id)) ||
        new Set(nonEmpty).size !== nonEmpty.length
      ) {
        fail(409, "MAPPING_CONFLICT", "请逐行确认全部旧账号，每个公司账号只能关联一次");
      }
      if (nonEmpty.length !== selected.size && !payload.allowUnmapped) {
        fail(409, "UNMAPPED_CONFIRMATION_REQUIRED", "请确认留空账号保留数据，切换后不能使用旧登录");
      }
      if (
        !localUsers.some(
          (user) => user.is_admin && user.is_enabled && selected.get(user.local_user_id) != null
        )
      ) {
        fail(409, "ADMIN_MAPPING_REQUIRED", "至少关联一名启用的原管理员才能完成接入");
      }
      for (const [localId, ssoId] of selected) {
        if (ssoId !== null) requireRosterUser(roster, ssoId);
        const previous = localById.get(localId)!.sso_user_id;
        if (previous !== null && previous !== ssoId) {
          fail(409, "MAPPING_CONFLICT", "已有公司账号关联不能被覆盖");
        }
      }
      for (const row of phoneRows) {
        if (row.sso_user_id !== null && matched.get(row.local_user_id) !== row.sso_user_id) {
          fail(409, "MAPPING_CONFLICT", "手机号推荐已经变化或冲突，请重新推荐或手动确认");
        }
      }
      const identitiesBefore = await identitySnapshot(tx);
      const snapshot: Record<string, number | null> = {};
      for (const user of localUsers) snapshot[user.local_user_id] = user.sso_user_id;
      for (const [localId, ssoId] of selected) {
        if (ssoId !== null) {
          const person = requireRosterUser(roster, ssoId);
          await bindIdentity(tx, localId, owner.settings.ssoApiUrl, {
            userId: ssoId, dingCorpId: person.ding_corp_id, dingUserId: person.ding_user_id,
          });
        }
        await tx.user.update({
          where: { id: localId },
          data: { ssoUserId: ssoId },
        });
      }
      const usersAfter = await tx.user.findMany({ orderBy: userOrderBy() });
      await tx.ssoSetupState.update({
        where: { id: 1 },
        data: {
          phase: PHASES.ADMIN_VERIFICATION_REQUIRED,
          revision: state.revision + 1,
          snapshotJson: JSON.stringify(snapshot),
          identitySnapshotJson: JSON.stringify(identitiesBefore),
          mappedIdentityFingerprint: fingerprint(await identitySnapshot(tx)),
          mappedFingerprint: fingerprint(usersAfter.map(publicUser)),
          mappedUsersJson: JSON.stringify(usersAfter.map(publicUser)),
          rollbackAvailable: true,
          operatorLocalId: null,
          connectedSsoId: owner.identity.userId,
          adminRevision: null,
          adminExpires: null,
        },
      });
      await audit(
        tx,
        "mapping",
        state.revision + 1,
        { ssoActorId: owner.identity.userId },
        // 维护者 mapping 恢复的锚点：必须是可序列化的普通对象（Map 会丢失内容）
        Object.fromEntries(selected)
      );
      await tx.ssoSetupDraft.deleteMany({});
      return buildContext(tx, { roster, viewerId: owner.identity.userId });
    });
    return Response.json(context, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "保存账号关联失败");
  }
}
