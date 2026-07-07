import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const skip = (page - 1) * limit;

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;
    const userDepartment = (session.user as any).department || "";
    const where: any = {};

    if (userRole === "UPLOADER") {
      where.spu = { uploadedById: userId };
    } else if (userRole === "REVIEWER") {
      // 审核员看分配给自己的 SPU 的归档
      where.spu = { assignedReviewerId: userId };
    }

    const [archives, total] = await Promise.all([
      prisma.archive.findMany({
        where,
        include: {
          spu: {
            select: {
              images: {
                where: { status: "APPROVED" },
                select: { id: true, storedPath: true, filename: true, fileSize: true },
              },
            },
          },
        },
        orderBy: { archivedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.archive.count({ where }),
    ]);

    return NextResponse.json({
      archives,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Archive list error:", error);
    return NextResponse.json({ error: "获取归档列表失败" }, { status: 500 });
  }
}
