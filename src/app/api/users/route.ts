import type { Prisma } from "@prisma/client";
import { lastAdminGuardCondition } from "@/lib/sso/store";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, ssoSettings, sameOrigin, recheckActor, withBusinessTransaction, type Actor } from "@/lib/sso/identity";
import { handleApiError, fail } from "@/lib/sso/errors";
import { assertUserMutationAllowed, getState, type SsoState } from "@/lib/sso/store";

const ASSIGNABLE_ROLES = ["ADMIN", "REVIEWER", "UPLOADER", "PENDING"];

/** Serialize this permission decision with its write, including SQLite's deferred transaction lock. */
async function mutateUsers<T>(actor: Actor, change: (tx: Prisma.TransactionClient, state: SsoState) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "SsoSetupState" SET "revision" = "revision" WHERE "id" = 1`;
        const state = await getState(tx);
        assertUserMutationAllowed(state, { creation: false });
        const currentActor = await recheckActor(tx, actor);
        if (currentActor.user.role !== "ADMIN") fail(403, "LOCAL_FORBIDDEN", "管理员权限已经变化，请刷新后重试");
        return change(tx, state);
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (!["P1008", "P2028", "P2034"].includes(String(code))) throw error;
      if (attempt === 2) fail(409, "MAPPING_CONFLICT", "账号权限正在更新，请稍后重试");
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  fail(409, "MAPPING_CONFLICT", "账号权限正在更新，请稍后重试");
}

async function preserveLastAdmin(tx: Prisma.TransactionClient, state: SsoState, targetId: string) {
  const others = await tx.user.count({ where: {
    id: { not: targetId }, role: "ADMIN", ...lastAdminGuardCondition(state.phase),
  } });
  if (others === 0) fail(409, "LAST_ADMIN_REQUIRED", "至少保留一名启用的本地管理员");
}

export async function GET(req: NextRequest) {
  try {
    return await withBusinessTransaction(req, async (prisma, actor) => {
    const user = actor.user;

    // ADMIN 和审核员可以查看用户列表
    const isReviewer = user.role === "REVIEWER";
    if (user.role !== "ADMIN" && !isReviewer) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const role = searchParams.get("role");

    const where: any = {};
    if (role) where.role = role;

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        department: true,
        email: true,
        role: true,
        ssoUserId: true,
        rosterStatus: true, rosterCheckedAt: true, rosterSource: true, rosterDepartment: true, rosterName: true,
        createdAt: true,
        _count: { select: { uploadedSpus: true, reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(users.map(({ rosterSource, rosterDepartment, rosterName, rosterStatus, rosterCheckedAt, ...u }) => {
      const current = actor.authMethod === "sso" && rosterSource === ssoSettings().ssoApiUrl;
      return { ...u, department: (current ? rosterDepartment : null) ?? u.department,
        name: (current ? rosterName : null) ?? u.name,
        rosterStatus: current ? rosterStatus : null, rosterCheckedAt: current ? rosterCheckedAt : null };
    }));
    });
  } catch (error) {
    return handleApiError(error, "获取用户列表失败");
  }
}

/** 角色分配：管理员使用原角色模型分配权限，下一次请求生效 */
export async function PATCH(req: NextRequest) {
  try {
    sameOrigin(req);
    const actor = await getActor(req, { business: true });
    if (actor.user.role !== "ADMIN") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { id, role } = await req.json();
    if (typeof id !== "string" || !id || typeof role !== "string" || !ASSIGNABLE_ROLES.includes(role)) {
      return NextResponse.json({ error: "请提供用户ID和有效角色" }, { status: 400 });
    }

    const updated = await mutateUsers(actor, async (tx, state) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) fail(404, "LOCAL_USER_NOT_FOUND", "用户不存在");
      if (target.role === "ADMIN" && role !== "ADMIN") await preserveLastAdmin(tx, state, id);
      return tx.user.update({ where: { id }, data: { role } });
    });
    return NextResponse.json({
      id: updated!.id,
      name: updated!.name,
      role: updated!.role,
      ssoUserId: updated!.ssoUserId,
    });
  } catch (error) {
    return handleApiError(error, "更新用户角色失败");
  }
}

export async function DELETE(req: NextRequest) {
  try {
    sameOrigin(req);
    const actor = await getActor(req, { business: true });
    if (actor.user.role !== "ADMIN") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    if (actor.authMethod === "sso") fail(409, "STATE_CONFLICT", "请在公司账号中心撤销访问，历史记录予以保留");
    const { id } = await req.json();
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "缺少用户ID" }, { status: 400 });
    }

    // 不能删除自己
    if (id === actor.user.id) {
      return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
    }

    // 事务内重查操作者、阶段、目标和最后管理员，再执行既有级联删除。
    await mutateUsers(actor, async (tx, state) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) fail(404, "LOCAL_USER_NOT_FOUND", "用户不存在");
      if (target.role === "ADMIN") await preserveLastAdmin(tx, state, id);
      // 1. 删除该用户的审核记录
      await tx.reviewRecord.deleteMany({ where: { reviewerId: id } });

      // 2. 找到该用户上传的所有图片ID
      const userImages = await tx.image.findMany({
        where: { uploadedById: id },
        select: { id: true, spuId: true },
      });
      const imageIds = userImages.map((img) => img.id);
      const spuIds = [...new Set(userImages.map((img) => img.spuId))];

      // 3. 删除这些图片关联的审核记录
      if (imageIds.length > 0) {
        await tx.reviewRecord.deleteMany({ where: { imageId: { in: imageIds } } });
      }

      // 4. 删除图片
      await tx.image.deleteMany({ where: { uploadedById: id } });

      // 5. 删除这些 SPU 的归档记录
      if (spuIds.length > 0) {
        await tx.archive.deleteMany({ where: { spuId: { in: spuIds } } });
      }

      // 6. 解除该用户作为审核员的 SPU 分配
      await tx.spu.updateMany({
        where: { assignedReviewerId: id },
        data: { assignedReviewerId: null },
      });

      // 7. 删除该用户上传的 SPU（image 已在第4步删除，外键不再阻拦）
      await tx.spu.deleteMany({ where: { uploadedById: id } });

      // 8. 删除该用户的通知
      await tx.notification.deleteMany({ where: { userId: id } });

      // 9. 最后删除用户
      await tx.user.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "删除用户失败");
  }
}
