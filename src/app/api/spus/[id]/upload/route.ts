import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

async function ensureDir(dir: string) {
  try {
    await mkdir(dir, { recursive: true });
  } catch {}
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id: spuId } = await params;
    const spu = await prisma.spu.findUnique({ where: { id: spuId } });
    if (!spu) {
      return NextResponse.json({ error: "SPU任务不存在" }, { status: 404 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }

    await ensureDir(UPLOAD_DIR);
    const userId = (session.user as any).id;
    const batchId = uuidv4(); // 每次上传生成一个批次ID
    const uploadedImages = [];

    for (const file of files) {
      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `不支持的文件类型: ${file.type || "未知"}，仅支持 PNG/JPG/WebP/GIF` },
          { status: 400 }
        );
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `文件 "${file.name}" 超过 10MB 限制（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）` },
          { status: 400 }
        );
      }
      const ext = path.extname(file.name) || ".png";
      const uniqueName = `${uuidv4()}${ext}`;
      const filePath = path.join(UPLOAD_DIR, uniqueName);

      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);

      const image = await prisma.image.create({
        data: {
          filename: file.name,
          storedPath: `/uploads/${uniqueName}`,
          thumbnailPath: `/uploads/${uniqueName}`,
          fileSize: buffer.length,
          mimeType: file.type || "image/png",
          spuId,
          uploadedById: userId,
          batchId,
        },
      });

      uploadedImages.push(image);
    }

    // Reset SPU status to PENDING if new images added
    if (spu.status !== "PENDING") {
      await prisma.spu.update({ where: { id: spuId }, data: { status: "PENDING" } });
    }

    return NextResponse.json(uploadedImages, { status: 201 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}

// GET - List images for a SPU
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id: spuId } = await params;
    const images = await prisma.image.findMany({
      where: { spuId },
      orderBy: { createdAt: "asc" },
      include: {
        reviews: {
          include: { reviewer: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        uploadedBy: { select: { name: true, department: true } },
      },
    });

    return NextResponse.json(images);
  } catch (error) {
    console.error("Get SPU images error:", error);
    return NextResponse.json({ error: "获取图片列表失败" }, { status: 500 });
  }
}

// DELETE - Delete an image from SPU
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { id: spuId } = await params;
    const { imageId } = await req.json();
    if (!imageId) {
      return NextResponse.json({ error: "缺少图片ID" }, { status: 400 });
    }

    const image = await prisma.image.findFirst({ where: { id: imageId, spuId } });
    if (!image) {
      return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    }

    await prisma.image.delete({ where: { id: imageId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete image error:", error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
