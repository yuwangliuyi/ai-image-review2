import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const userRole = (session.user as any).role;
    const userId = (session.user as any).id;
    const userDepartment = (session.user as any).department || "";
    const { searchParams } = new URL(req.url);
    const dimension = searchParams.get("dimension") || "overall"; // overall | department | personal
    const deptParam = searchParams.get("department") || "";

    /* ── 维度过滤逻辑 ── */
    let baseWhere: any = {};
    let imageWhere: any = {};
    let reviewWhere: any = {};

    if (dimension === "personal") {
      // 个人维度：只看自己的数据
      if (userRole === "REVIEWER") {
        baseWhere = { assignedReviewerId: userId };
        imageWhere = { spu: { assignedReviewerId: userId } };
        reviewWhere = { image: { spu: { assignedReviewerId: userId } }, reviewerId: userId };
      } else if (userRole === "UPLOADER") {
        baseWhere = { uploadedById: userId };
        imageWhere = { uploadedById: userId };
        reviewWhere = { image: { uploadedById: userId } };
      } else {
        // ADMIN 个人维度：也看全局（或可改为自己部门的）
        baseWhere = {};
        imageWhere = {};
        reviewWhere = {};
      }
    } else if (dimension === "department") {
      // 部门维度
      const dept = deptParam || userDepartment;
      baseWhere = { department: dept };
      imageWhere = { spu: { department: dept } };
      reviewWhere = { image: { spu: { department: dept } } };
    } else {
      // overall：角色默认过滤
      if (userRole === "UPLOADER") {
        baseWhere = { uploadedById: userId };
        imageWhere = { uploadedById: userId };
        reviewWhere = { image: { uploadedById: userId } };
      } else if (userRole === "REVIEWER") {
        baseWhere = { assignedReviewerId: userId };
        imageWhere = { spu: { assignedReviewerId: userId } };
        reviewWhere = { image: { spu: { assignedReviewerId: userId } } };
      }
    }

    /* ── 基础统计 ── */
    const [
      totalSpus, pendingCount, approvedCount, rejectedCount,
      totalImages, totalArchived, recentReviews,
      categoryDistribution, rejectionReasons,
    ] = await Promise.all([
      prisma.spu.count({ where: baseWhere }),
      prisma.spu.count({ where: { ...baseWhere, status: "PENDING" } }),
      prisma.spu.count({ where: { ...baseWhere, status: "APPROVED" } }),
      prisma.spu.count({ where: { ...baseWhere, status: "REJECTED" } }),
      prisma.image.count({ where: imageWhere }),
      prisma.archive.count(),
      prisma.reviewRecord.findMany({
        where: reviewWhere,
        include: {
          reviewer: { select: { name: true } },
          image: { include: { spu: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      // 品类分布
      prisma.spu.groupBy({
        by: ["category"],
        where: { ...baseWhere, category: { not: "" } },
        _count: { id: true },
      }).then(async (cats) => {
        const enriched = await Promise.all(
          cats.map(async (c) => {
            const approved = await prisma.spu.count({
              where: { ...baseWhere, category: c.category, status: "APPROVED" },
            });
            const rejected = await prisma.spu.count({
              where: { ...baseWhere, category: c.category, status: "REJECTED" },
            });
            return {
              category: c.category,
              count: c._count.id,
              approved,
              rejected,
              approvalRate: c._count.id > 0
                ? ((approved / c._count.id) * 100).toFixed(1)
                : "0",
            };
          })
        );
        return enriched.sort((a, b) => b.count - a.count).slice(0, 10);
      }),
      // 驳回原因
      prisma.reviewRecord.findMany({
        where: { ...reviewWhere, action: "REJECTED", comment: { not: null } },
        select: { comment: true, image: { select: { filename: true, spu: { select: { name: true } } } }, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    /* ── 近7天趋势 ── */
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyUploads = await prisma.spu.groupBy({
      by: ["createdAt"],
      _count: { id: true },
      where: { ...baseWhere, createdAt: { gte: sevenDaysAgo } },
    });

    const dailyData: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyData[key] = 0;
    }
    dailyUploads.forEach((d) => {
      const key = d.createdAt.toISOString().slice(0, 10);
      if (dailyData[key] !== undefined) dailyData[key] = d._count.id;
    });

    /* ── 审核员统计（在当前过滤范围内） ── */
    const reviewerStats = await prisma.reviewRecord.groupBy({
      by: ["reviewerId"],
      _count: { id: true },
      where: reviewWhere,
    });

    const reviewerApproved = await prisma.reviewRecord.groupBy({
      by: ["reviewerId"],
      _count: { id: true },
      where: { ...reviewWhere, action: "APPROVED" },
    });

    const reviewerRejected = await prisma.reviewRecord.groupBy({
      by: ["reviewerId"],
      _count: { id: true },
      where: { ...reviewWhere, action: "REJECTED" },
    });

    const approvedMap: Record<string, number> = {};
    reviewerApproved.forEach((r) => (approvedMap[r.reviewerId] = r._count.id));
    const rejectedMap: Record<string, number> = {};
    reviewerRejected.forEach((r) => (rejectedMap[r.reviewerId] = r._count.id));

    const reviewers = await Promise.all(
      reviewerStats.map(async (s) => {
        const user = await prisma.user.findUnique({
          where: { id: s.reviewerId },
          select: { name: true, department: true },
        });
        const approved = approvedMap[s.reviewerId] || 0;
        const rejected = rejectedMap[s.reviewerId] || 0;
        const total = approved + rejected;
        return {
          id: s.reviewerId,
          name: user?.name || "未知",
          department: user?.department || "",
          total,
          approved,
          rejected,
          approvalRate: total > 0 ? ((approved / total) * 100).toFixed(1) : "0",
        };
      })
    );

    /* ── 部门汇总（仅 overall 维度需要全部部门） ── */
    const deptSpus = await prisma.spu.groupBy({
      by: ["department"],
      _count: { id: true },
    });

    const deptApproved = await prisma.spu.groupBy({
      by: ["department"],
      _count: { id: true },
      where: { status: "APPROVED" },
    });

    const deptRejected = await prisma.spu.groupBy({
      by: ["department"],
      _count: { id: true },
      where: { status: "REJECTED" },
    });

    const deptApprovedMap: Record<string, number> = {};
    deptApproved.forEach((d) => (deptApprovedMap[d.department] = d._count.id));
    const deptRejectedMap: Record<string, number> = {};
    deptRejected.forEach((d) => (deptRejectedMap[d.department] = d._count.id));

    const departments = deptSpus
      .filter((d) => d.department)
      .map((d) => {
        const approved = deptApprovedMap[d.department] || 0;
        const rejected = deptRejectedMap[d.department] || 0;
        const total = approved + rejected;
        return {
          department: d.department,
          totalSpus: d._count.id,
          approved,
          rejected,
          approvalRate: total > 0 ? ((approved / total) * 100).toFixed(1) : "0",
        };
      });

    // 当前维度信息
    const currentDept = dimension === "department" ? (deptParam || userDepartment) : "";

    return NextResponse.json({
      // 汇总
      totalSpus,
      totalImages,
      pendingCount,
      approvedCount,
      rejectedCount,
      totalArchived,
      approvalRate: totalSpus > 0 ? ((approvedCount / totalSpus) * 100).toFixed(1) : "0",
      // 上下文
      dimension,
      currentDepartment: currentDept,
      currentUser: { id: userId, role: userRole, department: userDepartment },
      // 列表
      recentReviews,
      reviewers,
      departments,
      categoryDistribution,
      rejectionReasons,
      dailyData: Object.entries(dailyData).map(([date, count]) => ({ date, count })),
    });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "获取统计数据失败" }, { status: 500 });
  }
}
