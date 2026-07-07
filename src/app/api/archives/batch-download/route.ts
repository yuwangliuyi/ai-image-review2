import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import path from "path";
import { stat } from "fs/promises";

const archiver = require("archiver");
const { PassThrough } = require("stream");

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要下载的归档" }, { status: 400 });
    }

    // 查询所有选中归档 + 已通过图片
    const archives = await prisma.archive.findMany({
      where: { id: { in: ids } },
      include: {
        spu: { select: { name: true } },
      },
    });

    if (archives.length === 0) {
      return NextResponse.json({ error: "未找到选中归档" }, { status: 404 });
    }

    const publicDir = path.join(process.cwd(), "public");
    const archive_stream = archiver("zip", {
      zlib: { level: 6 },
      forceUTF8: true,
    });

    const chunks: Buffer[] = [];
    const pt = new PassThrough();
    pt.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive_stream.pipe(pt);

    let totalFiles = 0;
    const addedPaths = new Set<string>(); // 去重：同名路径不重复添加

    for (const archive of archives) {
      // 找该 SPU 最新批次的已通过图片
      const latestApproved = await prisma.image.findFirst({
        where: { spuId: archive.spuId, status: "APPROVED", batchId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { batchId: true },
      });

      const images = latestApproved?.batchId
        ? await prisma.image.findMany({
            where: { spuId: archive.spuId, status: "APPROVED", batchId: latestApproved.batchId },
            select: { storedPath: true, storedLocalPath: true, filename: true },
          })
        : await prisma.image.findMany({
            where: { spuId: archive.spuId, status: "APPROVED" },
            select: { storedPath: true, storedLocalPath: true, filename: true },
          });

      // ZIP 内按「品类/SPU名称/」组织
      const folder = [archive.category, archive.spuName].filter(Boolean).join("/");

      for (const img of images) {
        const srcPath = img.storedLocalPath
          ? img.storedLocalPath
          : path.join(publicDir, img.storedPath);
        try {
          await stat(srcPath);
          const zipPath = `${folder}/${img.filename}`;
          if (!addedPaths.has(zipPath)) {
            archive_stream.file(srcPath, { name: zipPath });
            addedPaths.add(zipPath);
            totalFiles++;
          }
        } catch {
          // 跳过缺失文件
        }
      }
    }

    if (totalFiles === 0) {
      return NextResponse.json({ error: "所选归档中没有可下载的图片" }, { status: 404 });
    }

    await archive_stream.finalize();
    await new Promise<void>((resolve) => {
      pt.on("end", resolve);
    });

    const zipBuffer = Buffer.concat(chunks);
    const label = archives.length === 1
      ? archives[0].spuName
      : `批量下载_${archives.length}个SPU`;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const zipFileName = `${label}_${ts}.zip`;

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName)}`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Batch download error:", error);
    return NextResponse.json({ error: "批量下载失败" }, { status: 500 });
  }
}
