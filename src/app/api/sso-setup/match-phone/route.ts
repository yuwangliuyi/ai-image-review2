import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, fail, SsoError } from "@/lib/sso/errors";
import { requireOwnerSso } from "@/lib/sso/identity";
import { phoneSuggestions } from "@/lib/sso/phone";
import { assertWizardState, readRevisionBody } from "@/lib/sso/setup-context";
import {
  PHASES,
  checkRevision,
  draftRows,
  getState,
  reviewFingerprint,
  usersSnapshot,
  phoneValuesFor,
} from "@/lib/sso/store";

export const dynamic = "force-dynamic";

/** 受限手机号推荐：服务端读原模型号码，只建议、不写关联 */
export async function POST(req: NextRequest) {
  try {
    const owner = await requireOwnerSso(req);
    const revision = await readRevisionBody(req);
    const reviewed = await prisma.$transaction(async (tx) => {
      const state = assertWizardState(await getState(tx));
      checkRevision(state, revision, PHASES.MAPPING_REQUIRED);
      const current = await reviewFingerprint(tx);
      if (state.reviewFingerprint !== current) {
        fail(409, "REVISION_CONFLICT", "原账号资料已经变化，请刷新后获取推荐");
      }
      return current;
    });
    const users = await usersSnapshot(prisma);
    const phones = phoneValuesFor(users);
    const draft = await draftRows(prisma);
    let matched: Awaited<ReturnType<typeof phoneSuggestions>>;
    let available = true;
    let message = "仅预选唯一手机号候选，请核对后统一提交关联";
    try {
      matched = await phoneSuggestions(owner.client, owner.token, users, phones, draft);
    } catch (error) {
      // 中心不支持/限频/故障：推荐降级，手选与保存进度不受影响
      if (!(error instanceof SsoError) || error.status !== 503) throw error;
      matched = [];
      available = false;
      message = "手机号推荐暂时不可用，可以手动选择或保存草稿";
    }
    // 推荐期间账号资料变化：拒绝使用过期结果
    await prisma.$transaction(async (tx) => {
      const state = assertWizardState(await getState(tx));
      checkRevision(state, revision, PHASES.MAPPING_REQUIRED);
      if (reviewed !== state.reviewFingerprint || reviewed !== (await reviewFingerprint(tx))) {
        fail(409, "REVISION_CONFLICT", "获取推荐期间账号资料已变化，请刷新后重试");
      }
    });
    return Response.json(
      { revision, available, message, suggestions: matched },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleApiError(error, "手机号推荐失败");
  }
}
