import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  let databaseUrl = process.env.DATABASE_URL;
  const sqlite = databaseUrl?.startsWith("file:");
  if (sqlite && databaseUrl) {
    const queryStart = databaseUrl.indexOf("?");
    const path = queryStart < 0 ? databaseUrl : databaseUrl.slice(0, queryStart);
    const params = new URLSearchParams(queryStart < 0 ? "" : databaseUrl.slice(queryStart + 1));
    // SQLite interactive transactions use BEGIN IMMEDIATE. Queue them on one
    // connection instead of letting concurrent pools block each other on a write lock.
    params.set("connection_limit", "1");
    databaseUrl = `${path}?${params}`;
  }
  const client = new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);

  // Initialize once, including when production route bundles import this module separately.
  if (sqlite) {
    client.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch((err) => {
      console.error("[db] 开启 WAL 模式失败：", err);
    });
  }
  return client;
}

export const prisma = globalForPrisma.prisma ?? (globalForPrisma.prisma = createClient());
