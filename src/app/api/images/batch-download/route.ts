import { NextRequest, NextResponse } from "next/server";
import { withBusinessTransaction } from "@/lib/sso/identity";
import { handleApiError } from "@/lib/sso/errors";
import { readFile, stat } from "fs/promises";
import path from "path";
import JSZip from "jszip";

export async function POST(req: NextRequest) {
  try {
    return await withBusinessTransaction(req, async (prisma, actor) => {
    const session = { user: actor.user };

    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要下载的图片" }, { status: 400 });
    }

    const images = await prisma.image.findMany({
      where: { id: { in: ids }, status: "APPROVED" },
      select: {
        id: true,
        filename: true,
        storedPath: true,
        storedLocalPath: true,
        spu: { select: { name: true, category: true } },
      },
    });

    if (images.length === 0) {
      return NextResponse.json({ error: "未找到可下载的图片（仅已通过图片可下载）" }, { status: 404 });
    }

    const zip = new JSZip();
    const publicDir = path.join(process.cwd(), "public");
    const usedNames = new Map<string, number>();
    let added = 0;

    for (const img of images) {
      const srcPath = img.storedLocalPath
        ? img.storedLocalPath
        : path.join(publicDir, img.storedPath);
      try {
        await stat(srcPath);
        const buffer = await readFile(srcPath);

        // 处理同名：添加序号
        let zipName = img.filename;
        const count = usedNames.get(zipName) || 0;
        if (count > 0) {
          const dot = zipName.lastIndexOf(".");
          const base = dot > 0 ? zipName.slice(0, dot) : zipName;
          const ext = dot > 0 ? zipName.slice(dot) : "";
          zipName = `${base} (${count})${ext}`;
        }
        usedNames.set(img.filename, (usedNames.get(img.filename) || 0) + 1);

        const folder = img.spu.name || "未分类";
        zip.file(`${folder}/${zipName}`, buffer);
        added++;
      } catch {
        // 跳过缺失文件
      }
    }

    if (added === 0) {
      return NextResponse.json({ error: "所选图片文件不存在" }, { status: 404 });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const zipFileName = `图片批量下载_${images.length}张_${ts}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName)}`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
    });
  } catch (error) {
    return handleApiError(error, "批量下载失败");
  }
}
