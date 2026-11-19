import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { withBusinessTransaction, sameOrigin } from "@/lib/sso/identity";
import { handleApiError } from "@/lib/sso/errors";
import { assertUserMutationAllowed, getState } from "@/lib/sso/store";

export async function POST(req: NextRequest) {
  try {
    sameOrigin(req);
    return await withBusinessTransaction(req, async (prisma, actor) => {
    if (actor.user.role !== "ADMIN" && actor.user.role !== "REVIEWER") {
      return NextResponse.json({ error: "仅管理员或审核员可创建账号" }, { status: 403 });
    }
    // 接入阶段管控：待完成冻结；SSO_ONLY 关闭产生未关联密码账号的旧入口
    const state = await getState(prisma);
    assertUserMutationAllowed(state, { creation: true });

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
    });
  } catch (error) {
    return handleApiError(error, "注册失败");
  }
}
