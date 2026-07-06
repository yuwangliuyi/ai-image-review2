import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session?.user as any;

    // ADMIN 和审核员可以查看用户列表
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
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
        createdAt: true,
        _count: { select: { uploadedSpus: true, reviews: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error("List users error:", error);
    return NextResponse.json({ error: "获取用户列表失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user || (session.user as any).role !== "ADMIN") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "缺少用户ID" }, { status: 400 });
    }

    // 不能删除自己
    if (id === (session.user as any).id) {
      return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
    }

    // 事务级联清理关联数据
    await prisma.$transaction(async (tx) => {
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
    console.error("Delete user error:", error);
    return NextResponse.json({ error: "删除用户失败" }, { status: 500 });
  }
}
