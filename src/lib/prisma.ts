import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// 开启 SQLite WAL 模式：允许读写并发，避免批量上传时数据库查询超时（P1008）
if (process.env.DATABASE_URL?.startsWith("file:")) {
  prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch((err) => {
    console.error("[db] 开启 WAL 模式失败：", err);
  });
}
