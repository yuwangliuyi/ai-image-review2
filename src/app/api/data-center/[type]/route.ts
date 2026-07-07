import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { type } = await params;
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status");
    const search = searchParams.get("search") || "";
    const skip = (page - 1) * limit;

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;
    const userDepartment = (session.user as any).department || "";

    let items: any[] = [];
    let total = 0;

    switch (type) {
      case "spus": {
        const where: any = {};
        if (status && status !== "ALL") where.status = status;
        if (search) where.name = { contains: search };
        if (userRole === "UPLOADER") where.uploadedById = userId;
        else if (userRole === "REVIEWER") where.assignedReviewerId = userId;

        [items, total] = await Promise.all([
          prisma.spu.findMany({
            where,
            include: {
              uploadedBy: { select: { name: true, department: true } },
              _count: { select: { images: true } },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),
          prisma.spu.count({ where }),
        ]);

        // 为当前页的 SPU 补充通过/驳回计数
        const spuIds = items.map((s) => s.id);
        if (spuIds.length > 0) {
          const counts = await prisma.image.groupBy({
            by: ["spuId", "status"],
            where: { spuId: { in: spuIds } },
            _count: true,
          });
          // 附加到各 SPU
          for (const s of items) {
            (s as any)._approvedCount = 0;
            (s as any)._rejectedCount = 0;
            for (const c of counts) {
              if (c.spuId === s.id) {
                if (c.status === "APPROVED") (s as any)._approvedCount = c._count;
                if (c.status === "REJECTED") (s as any)._rejectedCount = c._count;
              }
            }
          }
        }
        break;
      }

      case "images": {
        const where: any = {};
        if (status && status !== "ALL") where.status = status;
        if (search) where.filename = { contains: search };
        if (userRole === "UPLOADER") where.uploadedById = userId;
        else if (userRole === "REVIEWER") where.spu = { assignedReviewerId: userId };

        [items, total] = await Promise.all([
          prisma.image.findMany({
            where,
            include: {
              spu: { select: { name: true } },
              uploadedBy: { select: { name: true } },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),
          prisma.image.count({ where }),
        ]);
        break;
      }

      case "reviews": {
        const where: any = {};
        if (status && status !== "ALL") where.action = status;
        if (search) {
          where.reviewer = { name: { contains: search } };
        }
        if (userRole === "UPLOADER") {
          where.image = { uploadedById: userId };
        } else if (userRole === "REVIEWER") {
          where.image = { spu: { assignedReviewerId: userId } };
        }

        [items, total] = await Promise.all([
          prisma.reviewRecord.findMany({
            where,
            include: {
              reviewer: { select: { name: true } },
              image: {
                include: {
                  spu: { select: { name: true } },
                },
              },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),
          prisma.reviewRecord.count({ where }),
        ]);
        break;
      }

      case "storage-inventory": {
        // 已通过图片存储清单（用于定期迁移/删除）
        // 支持 month 参数：格式 YYYY-MM，不传则返回全部
        const month = searchParams.get("month"); // YYYY-MM
        const where: any = { status: "APPROVED" };

        if (month) {
          const [y, m] = month.split("-").map(Number);
          const start = new Date(y, m - 1, 1);
          const end = new Date(y, m, 1);
          where.createdAt = { gte: start, lt: end };
        }

        if (userRole === "UPLOADER") where.uploadedById = userId;
        else if (userRole === "REVIEWER") where.spu = { assignedReviewerId: userId };

        [items, total] = await Promise.all([
          prisma.image.findMany({
            where,
            select: {
              id: true,
              filename: true,
              storedPath: true,
              storedLocalPath: true,
              fileSize: true,
              mimeType: true,
              createdAt: true,
              spu: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  countryStyle: true,
                  shopName: true,
                },
              },
              uploadedBy: { select: { name: true, department: true } },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),
          prisma.image.count({ where }),
        ]);
        break;
      }

      default:
        return NextResponse.json({ error: "无效的数据类型" }, { status: 400 });
    }

    return NextResponse.json({ items, total, page, limit });
  } catch (error) {
    console.error("Data center error:", error);
    return NextResponse.json({ error: "获取数据失败" }, { status: 500 });
  }
}
