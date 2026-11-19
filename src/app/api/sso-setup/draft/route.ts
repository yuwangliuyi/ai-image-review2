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
  reviewFingerprint,
  usersSnapshot,
  phoneValuesFor,
} from "@/lib/sso/store";

export const dynamic = "force-dynamic";

interface DraftRowInput {
  local_user_id: unknown;
  sso_user_id: unknown;
  selection_source?: unknown;
}

function parseRows(body: { rows?: unknown } | null): { local_user_id: string; sso_user_id: number | null; selection_source: "manual" | "phone" }[] {
  if (!Array.isArray(body?.rows)) {
    fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
  }
  return (body!.rows as DraftRowInput[]).map((row) => {
    if (
      typeof row?.local_user_id !== "string" ||
      !row.local_user_id ||
      row.local_user_id.length > 128
    ) {
      fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
    }
    if (row.sso_user_id !== null && row.sso_user_id !== undefined) {
      if (typeof row.sso_user_id !== "number" || !Number.isSafeInteger(row.sso_user_id) || row.sso_user_id <= 0) {
        fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
      }
    }
    const source = row.selection_source === "phone" ? "phone" : "manual";
    return { local_user_id: row.local_user_id, sso_user_id: (row.sso_user_id as number) ?? null, selection_source: source };
  });
}

/** 部分草稿：完整账号集合、版本有效、不覆盖已有映射；仅保存进度，不触发绑定 */
export async function POST(req: NextRequest) {
  try {
    const owner = await requireOwnerSso(req);
    const body = (await req.json().catch(() => null)) as { revision?: unknown; rows?: unknown } | null;
    const revision = body?.revision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
    }
    const rows = parseRows(body as { rows?: unknown });
    const context = await prisma.$transaction(async (tx) => {
      const state = assertWizardState(await getState(tx));
      checkRevision(state, revision, PHASES.MAPPING_REQUIRED);
      if (state.reviewFingerprint !== (await reviewFingerprint(tx))) {
        fail(409, "REVISION_CONFLICT", "原账号资料已经变化，请刷新后保存草稿");
      }
      const localUsers = await usersSnapshot(tx);
      const selected = new Map(rows.map((row) => [row.local_user_id, row.sso_user_id]));
      const nonEmpty = rows.map((row) => row.sso_user_id).filter((id) => id !== null) as number[];
      if (
        selected.size !== rows.length ||
        new Set(localUsers.map((user) => user.local_user_id)).size !== selected.size ||
        !localUsers.every((user) => selected.has(user.local_user_id)) ||
        new Set(nonEmpty).size !== nonEmpty.length
      ) {
        fail(409, "MAPPING_CONFLICT", "草稿必须保留全部原账号，所选公司账号不能重复");
      }
      for (const user of localUsers) {
        if (user.sso_user_id !== null && selected.get(user.local_user_id) !== user.sso_user_id) {
          fail(409, "MAPPING_CONFLICT", "已有公司账号关联不能被草稿覆盖");
        }
      }
      const sources = new Map(rows.map((row) => [row.local_user_id, row.selection_source]));
      const phones = phoneValuesFor(localUsers);
      const values = localUsers.map((user) => ({
        localId: user.local_user_id,
        ssoId: selected.get(user.local_user_id) ?? null,
        selectionSource: sources.get(user.local_user_id) || "manual",
        accountFingerprint: fingerprint(user),
        phoneFingerprint: fingerprint(phones.get(user.local_user_id) ?? null),
      }));
      const previous = await tx.ssoSetupDraft.findMany();
      const same =
        previous.length === values.length &&
        [...previous]
          .map((row) => `${row.localId}|${row.ssoId}|${row.selectionSource}|${row.accountFingerprint}|${row.phoneFingerprint}`)
          .sort()
          .join(";") ===
        values
          .map((row) => `${row.localId}|${row.ssoId}|${row.selectionSource}|${row.accountFingerprint}|${row.phoneFingerprint}`)
          .sort()
          .join(";");
      if (!same) {
        await tx.ssoSetupDraft.deleteMany({});
        await tx.ssoSetupDraft.createMany({ data: values });
        await tx.ssoSetupState.update({
          where: { id: 1 },
          data: { revision: state.revision + 1 },
        });
        await audit(
          tx,
          "draft",
          state.revision + 1,
          { ssoActorId: owner.identity.userId },
          { rows }
        );
      }
      return buildContext(tx, { viewerId: owner.identity.userId });
    });
    return Response.json(context, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "保存草稿失败");
  }
}
