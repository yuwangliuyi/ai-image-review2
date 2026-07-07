import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { readFile, stat } from "fs/promises";
import path from "path";
import JSZip from "jszip";

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

    const archives = await prisma.archive.findMany({
      where: { id: { in: ids } },
      include: { spu: { select: { name: true } } },
    });

    if (archives.length === 0) {
      return NextResponse.json({ error: "未找到选中归档" }, { status: 404 });
    }

    const zip = new JSZip();
    const publicDir = path.join(process.cwd(), "public");
    const addedPaths = new Set<string>();
    let added = 0;

    for (const archive of archives) {
      const images = await prisma.image.findMany({
        where: { spuId: archive.spuId, status: "APPROVED" },
        select: { storedPath: true, storedLocalPath: true, filename: true },
      });

      const folder = [archive.category, archive.spuName].filter(Boolean).join("/");

      for (const img of images) {
        const srcPath = img.storedLocalPath
          ? img.storedLocalPath
          : path.join(publicDir, img.storedPath);
        const zipPath = `${folder}/${img.filename}`;
        if (addedPaths.has(zipPath)) continue;

        try {
          await stat(srcPath);
          const buffer = await readFile(srcPath);
          zip.file(zipPath, buffer);
          addedPaths.add(zipPath);
          added++;
        } catch {
          // 跳过缺失文件
        }
      }
    }

    if (added === 0) {
      return NextResponse.json({ error: "所选归档中没有可下载的图片" }, { status: 404 });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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
