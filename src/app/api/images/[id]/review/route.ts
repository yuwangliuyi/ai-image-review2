import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { notifySpuStatusChange, notifyImageRejected } from "@/lib/notifications";
import { saveApprovedImage } from "@/lib/storage";
import path from "path";

const VALID_ACTIONS = ["APPROVED", "REJECTED"];

/** Auto-compute SPU status based on all its images, auto-archive, and notify uploader */
async function syncSpuStatus(spuId: string, spuName: string, uploadedById: string) {
  const images = await prisma.image.findMany({
    where: { spuId },
    select: { status: true },
  });

  if (images.length === 0) return;

  const allApproved = images.every((i) => i.status === "APPROVED");
  const anyRejected = images.some((i) => i.status === "REJECTED");
  const hasPending = images.some((i) => i.status === "PENDING");

  let spuStatus = "PENDING";
  if (allApproved) spuStatus = "APPROVED";
  else if (!hasPending && anyRejected) spuStatus = "REJECTED";

  const oldSpu = await prisma.spu.findUnique({
    where: { id: spuId },
    select: { status: true },
  });

  await prisma.spu.update({
    where: { id: spuId },
    data: { status: spuStatus },
  });

  // SPU 状态变更时通知上传者
  if (oldSpu && oldSpu.status !== spuStatus && spuStatus !== "PENDING") {
    const detail = spuStatus === "APPROVED"
      ? `${images.length} 张图片全部通过`
      : `${images.filter(i => i.status === "REJECTED").length} 张被驳回`;
    await notifySpuStatusChange(uploadedById, spuName, spuId, spuStatus, detail);
  }

  // 只要有图片通过就归档；全部驳回则删除归档
  const approvedCount = images.filter((i) => i.status === "APPROVED").length;

  if (approvedCount > 0) {
    const spu = await prisma.spu.findUnique({
      where: { id: spuId },
      select: {
        name: true,
        category: true,
        countryStyle: true,
        shopName: true,
        department: true,
        uploadedBy: { select: { name: true } },
      },
    });
    if (spu) {
      await prisma.archive.upsert({
        where: { spuId },
        create: {
          spuId,
          spuName: spu.name,
          category: spu.category || "",
          countryStyle: spu.countryStyle || "",
          shopName: spu.shopName || "",
          uploadedByName: spu.uploadedBy?.name || "",
          department: spu.department,
          imageCount: approvedCount,
        },
        update: {
          spuName: spu.name,
          category: spu.category || "",
          countryStyle: spu.countryStyle || "",
          shopName: spu.shopName || "",
          uploadedByName: spu.uploadedBy?.name || "",
          department: spu.department,
          imageCount: approvedCount,
        },
      });
    }
  } else {
    // 全部驳回：删除归档（如果之前存在）
    await prisma.archive.deleteMany({ where: { spuId } });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id: imageId } = await params;
    const { action, comment } = await req.json();

    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: "无效的审核操作，仅支持 APPROVED 或 REJECTED" },
        { status: 400 }
      );
    }

    const image = await prisma.image.findUnique({
      where: { id: imageId },
      include: {
        spu: { select: { id: true, name: true, category: true, countryStyle: true, shopName: true, uploadedById: true, assignedReviewerId: true } },
      },
    });
    if (!image) {
      return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    }

    // 权限校验：UPLOADER 无权审核
    const userRole = (session.user as any).role;
    const reviewerId = (session.user as any).id;
    if (userRole === "UPLOADER") {
      return NextResponse.json({ error: "无权执行审核操作" }, { status: 403 });
    }
    // 审核员只能审核分配给自己的 SPU
    if (userRole === "REVIEWER" && image.spu.assignedReviewerId !== reviewerId) {
      return NextResponse.json({ error: "无权审核该图片（未分配给你）" }, { status: 403 });
    }

    // 更新图片状态 + 创建审核记录
    await prisma.image.update({
      where: { id: imageId },
      data: { status: action },
    });

    await prisma.reviewRecord.create({
      data: {
        imageId,
        reviewerId,
        action,
        comment: comment || null,
      },
    });

    // 图片被驳回时通知上传者
    if (action === "REJECTED") {
      await notifyImageRejected(
        image.spu.uploadedById,
        image.filename,
        image.spu.name,
        image.spuId,
        comment || undefined
      );
    }

    // 审核通过时写入结构化储存路径（非关键路径，失败不影响审核结果）
    if (action === "APPROVED") {
      try {
        const sourcePath = path.join(process.cwd(), "public", image.storedPath);
        const localPath = await saveApprovedImage({
          sourcePath,
          originalFilename: image.filename,
          spu: {
            category: image.spu.category || "",
            countryStyle: image.spu.countryStyle || "",
            name: image.spu.name,
            shopName: image.spu.shopName || "",
          },
        });
        if (localPath) {
          await prisma.image.update({
            where: { id: imageId },
            data: { storedLocalPath: localPath },
          });
        }
      } catch (storageError) {
        console.error("[review] 结构化储存写入失败（审核结果不受影响）:", storageError);
      }
    }

    // 同步 SPU 状态（含自动归档 + 通知）
    await syncSpuStatus(image.spuId, image.spu.name, image.spu.uploadedById);

    return NextResponse.json({ success: true, action, imageId });
  } catch (error) {
    console.error("Image review error:", error);
    return NextResponse.json({ error: "审核失败" }, { status: 500 });
  }
}
