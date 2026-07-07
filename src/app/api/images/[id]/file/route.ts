import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { stat } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

/** 解析图片的实际文件路径：优先持久化存储 storedLocalPath，回退到 public/uploads */
async function resolveFilePath(image: { storedLocalPath: string | null; storedPath: string }) {
  // 优先使用持久化存储的绝对路径
  if (image.storedLocalPath) {
    try {
      await stat(image.storedLocalPath);
      return image.storedLocalPath;
    } catch {
      // 持久化文件不存在，继续回退
    }
  }
  // 回退到 public/uploads
  const filename = path.basename(image.storedPath);
  const filePath = path.join(UPLOAD_DIR, filename);
  await stat(filePath); // 如果也不存在，抛出异常
  return filePath;
}

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
    const image = await prisma.image.findUnique({
      where: { id },
      select: { storedPath: true, storedLocalPath: true, mimeType: true, filename: true, status: true },
    });
    if (!image) {
      return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    }

    let filePath: string;
    try {
      filePath = await resolveFilePath(image);
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
