// 审核通过图片的结构化储存服务
// 将 APPROVED 图片按规范路径复制到本地储存目录
// 路径规范：{root}/{品类}/{国家款式名称}/{SPU名称}/{店铺}/{原始文件名}

import { mkdir, copyFile, access } from "fs/promises";
import path from "path";
import { constants } from "fs";

/** 储存根目录 — 由环境变量控制，默认项目根下的 approved-images */
function getStorageRoot(): string {
  return process.env.APPROVED_STORAGE_ROOT || path.join(process.cwd(), "approved-images");
}

/** 构建结构化路径 */
function buildPath(spu: {
  category: string;
  countryStyle: string;
  name: string;
  shopName: string;
}): string {
  const dirs = [spu.category, spu.countryStyle, spu.name, spu.shopName]
    .map((s) => (s || "").trim())
    .filter(Boolean);

  return path.join(getStorageRoot(), ...dirs);
}

/** 检查文件是否已存在 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 将审核通过的图片写入结构化储存路径
 * @returns 储存后的绝对路径，如果文件已存在则返回 null（不覆盖）
 */
export async function saveApprovedImage(params: {
  sourcePath: string;       // public/uploads/xxx.png 绝对路径（已 resolve 好的完整路径）
  originalFilename: string; // 原始文件名
  spu: {
    category: string;
    countryStyle: string;
    name: string;
    shopName: string;
  };
}): Promise<string | null> {
  const { sourcePath, originalFilename, spu } = params;

  // 安全处理文件名：移除路径分隔符，保留原始扩展名
  const safeFilename = originalFilename.replace(/[/\\]/g, "_");
  const dirPath = buildPath(spu);
  const destPath = path.join(dirPath, safeFilename);

  // 去重：已存在则跳过
  if (await fileExists(destPath)) {
    console.log(`[storage] 跳过重复文件: ${destPath}`);
    return null;
  }

  // 创建目录并复制
  await mkdir(dirPath, { recursive: true });
  await copyFile(sourcePath, destPath);

  console.log(`[storage] 已储存: ${destPath}`);
  return destPath;
}

/**
 * 获取图片在结构化储存中的预期相对路径（用于前端展示/下载）
 */
export function getApprovedRelativePath(spu: {
  category: string;
  countryStyle: string;
  name: string;
  shopName: string;
}, filename: string): string {
  const safeFilename = filename.replace(/[/\\]/g, "_");
  const dirs = [spu.category, spu.countryStyle, spu.name, spu.shopName]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  return path.join(...dirs, safeFilename);
}
