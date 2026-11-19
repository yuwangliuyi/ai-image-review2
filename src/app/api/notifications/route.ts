import { NextRequest, NextResponse } from "next/server";
import { withBusinessTransaction } from "@/lib/sso/identity";
import { handleApiError } from "@/lib/sso/errors";

// GET - 获取当前用户的通知列表
export async function GET(req: NextRequest) {
  try {
    return await withBusinessTransaction(req, async (prisma, actor) => {
    const session = { user: actor.user };

    const userId = (session.user as any).id;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "20");
    const unreadOnly = searchParams.get("unread") === "true";

    const where: any = { userId };
    if (unreadOnly) where.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);

    return NextResponse.json({ notifications, total, unreadCount });
    });
  } catch (error) {
    return handleApiError(error, "获取通知失败");
  }
}

// PATCH - 标记通知为已读
export async function PATCH(req: NextRequest) {
  try {
    return await withBusinessTransaction(req, async (prisma, actor) => {
    const session = { user: actor.user };

    const userId = (session.user as any).id;
    const { id, all } = await req.json();

    if (all) {
      // 全部标记已读
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
    } else if (id) {
      // 标记单条已读
      await prisma.notification.updateMany({
        where: { id, userId },
        data: { read: true },
      });
    }

    const unreadCount = await prisma.notification.count({
      where: { userId, read: false },
    });

    return NextResponse.json({ success: true, unreadCount });
    });
  } catch (error) {
    return handleApiError(error, "操作失败");
  }
}
