import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user;
}

export function requireRole(...roles: string[]) {
  return async function () {
    const session = await getSession();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }
    const userRole = (session.user as any).role;
    if (!roles.includes(userRole)) {
      throw new Error("Forbidden");
    }
    return session.user;
  };
}
