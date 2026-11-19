import { NextRequest, NextResponse } from "next/server";
import { withBusinessTransaction } from "@/lib/sso/identity";
import { handleApiError } from "@/lib/sso/errors";
import { readFile, stat } from "fs/promises";
import path from "path";
import JSZip from "jszip";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    return await withBusinessTransaction(req, async (prisma, actor) => {
    const session = { user: actor.user };

    const { id } = await params;
    const archive = await prisma.archive.findUnique({
      where: { id },
      include: { spu: { select: { name: true } } },
    });

    if (!archive) {
      return NextResponse.json({ error: "归档不存在" }, { status: 404 });
    }

    // 该SPU下所有已通过的图片
    const images = await prisma.image.findMany({
      where: { spuId: archive.spuId, status: "APPROVED" },
      select: { storedPath: true, storedLocalPath: true, filename: true },
    });

    if (images.length === 0) {
      return NextResponse.json({ error: "该SPU下无图片" }, { status: 404 });
    }

    // ZIP 文件名
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipFileName = `${archive.spuName}_${ts}.zip`;

    // 归档文件夹结构：品类/SPU名称/
    const archivePath = [archive.category, archive.spuName].filter(Boolean).join("/");

    const zip = new JSZip();
    const publicDir = path.join(process.cwd(), "public");
    let added = 0;

    for (const img of images) {
      const srcPath = img.storedLocalPath
        ? img.storedLocalPath
        : path.join(publicDir, img.storedPath);
      try {
        await stat(srcPath);
        const buffer = await readFile(srcPath);
        zip.file(`${archivePath}/${img.filename}`, buffer);
        added++;
      } catch {
        // 跳过缺失的文件
      }
    }

    if (added === 0) {
      return NextResponse.json({ error: "该SPU下无可下载文件" }, { status: 404 });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName)}`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
    });
  } catch (error) {
    return handleApiError(error, "下载失败");
  }
}
