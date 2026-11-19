import { NextRequest, NextResponse } from "next/server";
import { withBusinessTransaction } from "@/lib/sso/identity";
import { handleApiError } from "@/lib/sso/errors";

export async function GET(req: NextRequest) {
  try {
    return await withBusinessTransaction(req, async (prisma, actor) => {
    const session = { user: actor.user };

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
    });
  } catch (error) {
    return handleApiError(error, "获取归档列表失败");
  }
}
