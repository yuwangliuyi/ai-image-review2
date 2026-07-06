import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { stat } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id } = await params;
    const image = await prisma.image.findUnique({ where: { id } });
    if (!image) {
      return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    }

    // 从 storedPath 提取文件名（/uploads/xxx.jpg → xxx.jpg）
    const filename = path.basename(image.storedPath);
    const filePath = path.join(UPLOAD_DIR, filename);

    // 检查文件是否存在
    try {
      await stat(filePath);
    } catch {
      return NextResponse.json({ error: "图片文件不存在" }, { status: 404 });
    }

    const buffer = await readFile(filePath);
    const mimeType = image.mimeType || "image/jpeg";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Image file serve error:", error);
    return NextResponse.json({ error: "获取图片失败" }, { status: 500 });
  }
}
