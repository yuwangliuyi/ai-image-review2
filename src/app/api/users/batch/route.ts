import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

/** 生成随机密码：8位，包含大小写字母和数字 */
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const user = session?.user as any;
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (user.role !== "ADMIN" && user.role !== "REVIEWER") {
      return NextResponse.json({ error: "仅管理员或审核员可批量创建账号" }, { status: 403 });
    }

    const { users } = await req.json();

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: "请提供要创建的用户列表" }, { status: 400 });
    }

    const results: Array<{
      name: string;
      department: string;
      role: string;
      password: string;
      status: "created" | "skipped" | "error";
      reason?: string;
    }> = [];

    for (const item of users) {
      const name = item.name?.trim();
      const department = item.department?.trim() || "未分配";
      const role = ["ADMIN", "REVIEWER", "UPLOADER"].includes(item.role) ? item.role : "UPLOADER";

      if (!name) {
        results.push({ name: item.name || "(空)", department, role, password: "", status: "error", reason: "姓名为空" });
        continue;
      }

      try {
        // 检查是否已存在同名用户
        const existing = await prisma.user.findUnique({ where: { name } });
        if (existing) {
          results.push({ name, department, role, password: "", status: "skipped", reason: "用户已存在" });
          continue;
        }

        const password = generatePassword();
        const hashedPassword = await bcrypt.hash(password, 12);

        await prisma.user.create({
          data: { name, department, email: "", password: hashedPassword, role },
        });

        results.push({ name, department, role, password, status: "created" });
      } catch (err: any) {
        results.push({ name, department, role, password: "", status: "error", reason: err.message || "创建失败" });
      }
    }

    const createdCount = results.filter((r) => r.status === "created").length;
    const skippedCount = results.filter((r) => r.status === "skipped").length;
    const errorCount = results.filter((r) => r.status === "error").length;

    return NextResponse.json({
      results,
      summary: { total: users.length, created: createdCount, skipped: skippedCount, error: errorCount },
    });
  } catch (error) {
    console.error("Batch user creation error:", error);
    return NextResponse.json({ error: "批量创建失败" }, { status: 500 });
  }
}
