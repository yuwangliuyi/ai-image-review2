import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";

/** 检查是否有创建账号权限：管理员 或 审核员 */
async function checkCanCreate(req: NextRequest) {
  const session = await getSession();
  const user = session?.user as any;
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  return user.role === "REVIEWER";
}

export async function POST(req: NextRequest) {
  try {
    if (!(await checkCanCreate(req))) {
      return NextResponse.json({ error: "仅管理员或审核员可创建账号" }, { status: 403 });
    }
    const { name, department, email, password, role } = await req.json();

    if (!name || !department || !password) {
      return NextResponse.json({ error: "请填写所有必填字段" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { name } });
    if (existingUser) {
      return NextResponse.json({ error: "该姓名已注册" }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const validRole = ["ADMIN", "REVIEWER", "UPLOADER"].includes(role) ? role : "UPLOADER";

    const user = await prisma.user.create({
      data: {
        name,
        department,
        email: email || "",
        password: hashedPassword,
        role: validRole,
      },
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      department: user.department,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "注册失败" }, { status: 500 });
  }
}
