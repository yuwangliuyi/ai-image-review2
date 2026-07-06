import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { notifySpuStatusChange } from "@/lib/notifications";
import { saveApprovedImage } from "@/lib/storage";
import path from "path";

// POST - 批量审核 SPU 下所有待审核的图片
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const userRole = (session.user as any).role;
    if (userRole !== "ADMIN" && userRole !== "REVIEWER") {
      return NextResponse.json({ error: "无审核权限" }, { status: 403 });
    }

    const { id: spuId } = await params;
    const { action, comment } = await req.json();
    const userId = (session.user as any).id;

    if (!["APPROVED", "REJECTED"].includes(action)) {
      return NextResponse.json({ error: "无效的审核操作" }, { status: 400 });
    }

    const spu = await prisma.spu.findUnique({
      where: { id: spuId },
      select: {
        id: true,
        name: true,
        uploadedById: true,
        department: true,
        category: true,
        countryStyle: true,
        shopName: true,
        assignedReviewerId: true,
        images: { where: { status: "PENDING" }, select: { id: true } },
        _count: { select: { images: true } },
      },
    });

    if (!spu) {
      return NextResponse.json({ error: "SPU任务不存在" }, { status: 404 });
    }

    // 权限校验：审核员只能审核分配给自己的 SPU
    if (userRole === "REVIEWER" && spu.assignedReviewerId !== userId) {
      return NextResponse.json({ error: "无权审核该 SPU（未分配给你）" }, { status: 403 });
    }

    if (spu.images.length === 0) {
      return NextResponse.json({ error: "没有待审核的图片" }, { status: 400 });
    }

    // 批量更新所有待审核图片 + 创建审核记录
    await prisma.$transaction([
      prisma.image.updateMany({
        where: { spuId, status: "PENDING" },
        data: { status: action },
      }),
      ...spu.images.map((img) =>
        prisma.reviewRecord.create({
          data: {
            imageId: img.id,
            reviewerId: userId,
            action,
            comment: comment || null,
          },
        })
      ),
    ]);

    // 同步 SPU 状态
    const allImages = await prisma.image.findMany({
      where: { spuId },
      select: { status: true },
    });
    const allApproved = allImages.every((i) => i.status === "APPROVED");
    const anyRejected = allImages.some((i) => i.status === "REJECTED");
    const hasPending = allImages.some((i) => i.status === "PENDING");
    // SPU 终态判定：无 PENDING 图片时才可定终态
    let spuStatus = "PENDING";
    if (allApproved) spuStatus = "APPROVED";
    else if (!hasPending && anyRejected) spuStatus = "REJECTED";

    await prisma.spu.update({ where: { id: spuId }, data: { status: spuStatus } });

    // 审核通过时批量写入结构化储存
    if (action === "APPROVED") {
      const approvedImages = await prisma.image.findMany({
        where: { spuId, status: "APPROVED", storedLocalPath: null },
        select: { id: true, filename: true, storedPath: true },
      });
      for (const img of approvedImages) {
        const sourcePath = path.join(process.cwd(), "public", img.storedPath);
        const localPath = await saveApprovedImage({
          sourcePath,
          originalFilename: img.filename,
          spu: {
            category: spu.category || "",
            countryStyle: spu.countryStyle || "",
            name: spu.name,
            shopName: spu.shopName || "",
          },
        });
        if (localPath) {
          await prisma.image.update({
            where: { id: img.id },
            data: { storedLocalPath: localPath },
          });
        }
      }
    }

    // 通知上传者
    if (spuStatus !== "PENDING") {
      const detail = spuStatus === "APPROVED"
        ? `共 ${allImages.length} 张图片全部通过`
        : `${allImages.filter(i => i.status === "REJECTED").length} 张被驳回`;
      await notifySpuStatusChange(spu.uploadedById, spu.name, spuId, spuStatus, detail);
    }

    // 只要有图片通过就归档（仅计数通过的）；全部驳回则删除归档
    const approvedCount = allImages.filter((i) => i.status === "APPROVED").length;

    if (approvedCount > 0) {
      await prisma.archive.upsert({
        where: { spuId },
        create: {
          spuId,
          spuName: spu.name,
          category: spu.category || "",
          countryStyle: spu.countryStyle || "",
          shopName: spu.shopName || "",
          uploadedByName: spu.uploadedById
            ? (await prisma.user.findUnique({ where: { id: spu.uploadedById }, select: { name: true } }))?.name || ""
            : "",
          department: spu.department,
          imageCount: approvedCount,
        },
        update: {
          spuName: spu.name,
          category: spu.category || "",
          countryStyle: spu.countryStyle || "",
          shopName: spu.shopName || "",
          uploadedByName: spu.uploadedById
            ? (await prisma.user.findUnique({ where: { id: spu.uploadedById }, select: { name: true } }))?.name || ""
            : "",
          department: spu.department,
          imageCount: approvedCount,
        },
      });
    } else {
      await prisma.archive.deleteMany({ where: { spuId } });
    }

    return NextResponse.json({
      success: true,
      action,
      count: spu.images.length,
      spuStatus,
    });
  } catch (error) {
    console.error("Batch review error:", error);
    return NextResponse.json({ error: "批量审核失败" }, { status: 500 });
  }
}
