import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import path from "path";
import { stat } from "fs/promises";
import archiver from "archiver";
import { PassThrough } from "stream";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const archive = await prisma.archive.findUnique({
      where: { id },
      include: {
        spu: { select: { name: true } },
      },
    });

    if (!archive) {
      return NextResponse.json({ error: "归档不存在" }, { status: 404 });
    }

    // 找到该SPU下最新一批有已通过图片的batchId
    const latestApproved = await prisma.image.findFirst({
      where: { spuId: archive.spuId, status: "APPROVED", batchId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { batchId: true },
    });
    const targetBatchId = latestApproved?.batchId;

    const images = targetBatchId
      ? await prisma.image.findMany({
          where: { spuId: archive.spuId, status: "APPROVED", batchId: targetBatchId },
          select: { storedPath: true, filename: true },
        })
      : await prisma.image.findMany({
          where: { spuId: archive.spuId, status: "APPROVED" },
          select: { storedPath: true, filename: true },
        });

    if (images.length === 0) {
      return NextResponse.json({ error: "该SPU下无图片" }, { status: 404 });
    }

    // ZIP 文件名
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFileName = `${archive.spuName}_${ts}.zip`;

    // 归档文件夹结构：品类/SPU名称/
    const archivePath = [archive.category, archive.spuName]
      .filter(Boolean)
      .join("/");

    const publicDir = path.join(process.cwd(), "public");

    // 使用 archiver 流式生成 ZIP（正确处理 UTF-8 extra field）
    const archive_stream = archiver("zip", {
      zlib: { level: 6 },
      // forceUTF8: true 确保文件名以 UTF-8 写入 ZIP
      forceUTF8: true,
    });

    const chunks: Buffer[] = [];
    const pt = new PassThrough();
    pt.on("data", (chunk: Buffer) => chunks.push(chunk));

    archive_stream.pipe(pt);

    // 逐个添加文件
    for (const img of images) {
      const srcPath = path.join(publicDir, img.storedPath);
      try {
        await stat(srcPath);
        // 在 ZIP 中的路径：品类/SPU名称/文件名
        const zipEntryPath = `${archivePath}/${img.filename}`;
        archive_stream.file(srcPath, { name: zipEntryPath });
      } catch {
        // 跳过缺失的文件
      }
    }

    // 等待 archiver 完成
    await archive_stream.finalize();

    // 等待流完成
    await new Promise<void>((resolve) => {
      pt.on("end", resolve);
    });

    const zipBuffer = Buffer.concat(chunks);

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName)}`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("ZIP download error:", error);
    return NextResponse.json({ error: "下载失败" }, { status: 500 });
  }
}
