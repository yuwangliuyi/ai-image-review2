import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

/**
 * 创建通知。返回创建的通知对象，失败返回 null。
 */
export async function createNotification(params: {
  userId: string;
  type: string;
  message: string;
  relatedId?: string;
}, db: Prisma.TransactionClient = prisma) {
  try {
    return await db.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        message: params.message,
        relatedId: params.relatedId || null,
      },
    });
  } catch (err) {
    console.error("Failed to create notification:", err);
    return null;
  }
}

/**
 * 通知 SPU 上传者：SPU 状态变更
 */
export async function notifySpuStatusChange(
  uploadedById: string,
  spuName: string,
  spuId: string,
  newStatus: string,
  details?: string,
  db: Prisma.TransactionClient = prisma
) {
  const label = newStatus === "APPROVED" ? "已全部通过 ✓" : newStatus === "REJECTED" ? "有图片被驳回 ✗" : "审核中";
  let message = `SPU「${spuName}」审核状态更新：${label}`;
  if (details) message += ` — ${details}`;

  return createNotification({
    userId: uploadedById,
    type: `SPU_${newStatus}`,
    message,
    relatedId: spuId,
  }, db);
}

/**
 * 通知上传者：单张图片被驳回
 */
export async function notifyImageRejected(
  uploadedById: string,
  imageFilename: string,
  spuName: string,
  spuId: string,
  comment?: string,
  db: Prisma.TransactionClient = prisma
) {
  let message = `图片「${imageFilename}」在 SPU「${spuName}」中被驳回`;
  if (comment) message += `，原因："${comment}"`;

  return createNotification({
    userId: uploadedById,
    type: "IMAGE_REJECTED",
    message,
    relatedId: spuId,
  }, db);
}
