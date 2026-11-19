import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authCookies } from "./auth-cookies";

export const authOptions: NextAuthOptions = {
  cookies: authCookies(),
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        name: { label: "姓名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.name || !credentials?.password) {
          throw new Error("请输入姓名和密码");
        }

        // guided 接入阶段管控：SSO_ONLY / 维护锁下拒绝原登录（后端层面关闭）
        const ssoState = await prisma.ssoSetupState.findUnique({ where: { id: 1 } });
        if (ssoState?.phase === "SSO_ONLY") {
          throw new Error("已切换为公司账号登录");
        }
        if (ssoState?.maintenanceLocked) {
          throw new Error("应用正在核对账号关联，请联系维护者");
        }

        const user = await prisma.user.findUnique({
          where: { name: credentials.name },
        });

        if (!user) {
          throw new Error("用户不存在");
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          throw new Error("密码错误");
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          department: user.department,
          role: user.role,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.department = (user as any).department;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).department = token.department;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
