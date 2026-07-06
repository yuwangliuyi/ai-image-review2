import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

/** 从所有审核员中随机选取一位分配任务 */
async function pickReviewer(): Promise<string> {
  const reviewers = await prisma.user.findMany({
    where: { role: "REVIEWER" },
    select: { id: true },
  });
  if (reviewers.length === 0) return "";
  const picked = reviewers[Math.floor(Math.random() * reviewers.length)];
  return picked.id;
}

// POST - Create a new SPU task
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { name, category, countryStyle, shopName } = await req.json();
    if (!name) {
      return NextResponse.json({ error: "请填写SPU名称" }, { status: 400 });
    }

    // 品类必填且必须来自已知分类列表
    const { CATEGORIES } = await import("@/lib/categories");
    const finalCategory = (category || "").trim();
    if (!finalCategory) {
      return NextResponse.json({ error: "请选择品类" }, { status: 400 });
    }
    if (!CATEGORIES.includes(finalCategory)) {
      return NextResponse.json({ error: "无效的品类名称，请从列表中选择" }, { status: 400 });
    }

    // 店铺名称校验（如果填写则必须来自注册表）
    const finalShopName = (shopName || "").trim();
    if (finalShopName) {
      const { STORES } = await import("@/lib/stores");
      if (!STORES.includes(finalShopName)) {
        return NextResponse.json({ error: "无效的店铺名称，请从列表中选择" }, { status: 400 });
      }
    }

    const userId = (session.user as any).id;
    const department = (session.user as any).department || "";

    // 确保用户存在
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "用户信息已过期，请重新登录" }, { status: 401 });
    }

    // 自动分配审核员
    const assignedReviewerId = await pickReviewer();

    const spu = await prisma.spu.create({
      data: {
        name,
        category: finalCategory,
        countryStyle: (countryStyle || "").trim(),
        shopName: finalShopName,
        uploadedById: userId,
        department,
        assignedReviewerId: assignedReviewerId || null,
      },
      include: {
        uploadedBy: { select: { name: true } },
        assignedReviewer: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });

    return NextResponse.json(spu, { status: 201 });
  } catch (error) {
    console.error("Create SPU error:", error);
    return NextResponse.json({ error: "创建SPU任务失败" }, { status: 500 });
  }
}

// GET - List SPU tasks
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;
    const userDepartment = (session.user as any).department || "";
    if (userRole === "UPLOADER") {
      // 上传者只看自己创建的 SPU
      where.uploadedById = userId;
    } else if (userRole === "REVIEWER") {
      // 审核员只看分配给自己的 SPU
      where.assignedReviewerId = userId;
    }

    const [spus, total] = await Promise.all([
      prisma.spu.findMany({
        where,
        include: {
          uploadedBy: { select: { name: true } },
          assignedReviewer: { select: { name: true } },
          images: { select: { id: true, storedPath: true, status: true } },
          _count: { select: { images: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.spu.count({ where }),
    ]);

    // 为每个 SPU 计算图片状态统计 + 取首张预览
    const spusWithStats = spus.map((spu) => {
      const images = spu.images || [];
      const statuses = { approved: 0, rejected: 0, pending: 0 };
      images.forEach((img) => {
        if (img.status === "APPROVED") statuses.approved++;
        else if (img.status === "REJECTED") statuses.rejected++;
        else statuses.pending++;
      });
      return {
        ...spu,
        _imageStatuses: statuses,
        images: images.slice(0, 1), // 仅保留首张用于预览
      };
    });

    return NextResponse.json({ spus: spusWithStats, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error("List SPUs error:", error);
    return NextResponse.json({ error: "获取SPU列表失败" }, { status: 500 });
  }
}
