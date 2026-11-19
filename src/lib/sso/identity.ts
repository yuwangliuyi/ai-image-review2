/**
 * 每请求身份层：SSO Bearer 与原 NextAuth 会话在此分流。
 * 后端逐请求 verify 身份与当前 app_id 准入；SSO 401/403 不回退旧会话。
 */
import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { readSsoSettings, type SsoSettings } from "./config";
import { fail } from "./errors";
import { SsoClient, type SsoIdentity } from "./sso-client";
import { bindIdentity, findIdentityUser, requireLegacyCoverage, requireSetupSource } from "./identity-mapping";
import { PHASES, getState, publicUser, type PublicUser } from "./store";

/** 待授权状态：JIT 新人的原项目“无业务权限”状态，所有业务接口统一拒绝 */
export const PENDING_ROLE = "PENDING";
/** 不可本地登录的密码占位（bcrypt.compare 对非法哈希恒为 false） */
export const NO_LOCAL_LOGIN_PASSWORD = "!SSO_ONLY!";

let cachedSettings: { value: SsoSettings } | null = null;
let cachedClient: { value: SsoClient } | null = null;

export function ssoSettings(): SsoSettings {
  cachedSettings ??= { value: readSsoSettings() };
  return cachedSettings.value;
}

export function ssoClient(): SsoClient {
  cachedClient ??= { value: new SsoClient(ssoSettings()) };
  return cachedClient.value;
}

export function getBearer(req: NextRequest): string {
  const value = req.headers.get("authorization") || "";
  const [scheme, ...rest] = value.split(" ");
  const token = rest.join(" ").trim();
  if (scheme.toLowerCase() !== "bearer" || !token || token !== value.slice(scheme.length + 1).trim()) {
    fail(401, "SSO_UNAUTHORIZED", "请通过公司账号登录");
  }
  return token;
}

/** 从请求头推导真实 origin（req.nextUrl.origin 在部分部署下会归一为 localhost） */
export function requestOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

/** 同源校验：接入接口与原业务 Cookie 写请求的 CSRF 防线 */
export function sameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (origin && origin.replace(/\/$/, "") !== requestOrigin(req).replace(/\/$/, "")) {
    fail(403, "CSRF_INVALID", "请从当前应用页面重新操作");
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    fail(403, "CSRF_INVALID", "请从当前应用页面重新操作");
  }
}

export interface OwnerContext {
  settings: SsoSettings;
  client: SsoClient;
  token: string;
  identity: SsoIdentity;
}

/** 接入接口授权：在线 verify 返回当前中心负责人关系，绝不接受前端自报或旧环境数字负责人 */
export async function requireOwnerSso(req: NextRequest): Promise<OwnerContext> {
  sameOrigin(req);
  const settings = ssoSettings();
  const client = ssoClient();
  const token = getBearer(req);
  const identity = await client.verify(token);
  if (!identity.isApplicationOwner) {
    fail(403, "APPLICATION_OWNER_REQUIRED", "请使用本应用负责人的公司账号操作");
  }
  const state = await getState(prisma);
  if (state.phase !== PHASES.SSO_ONLY) {
    requireSetupSource(state, settings.ssoApiUrl);
    await requireLegacyCoverage(prisma, state);
  }
  return { settings, client, token, identity };
}

export interface Actor {
  /** 当前请求的业务权限视图；原角色只保存在数据库与 publicUser.roles 中。 */
  user: User;
  authMethod: "local" | "sso";
  publicUser: PublicUser;
  isPending: boolean;
  isGlobalSuperAdmin: boolean;
  ssoIdentity?: SsoIdentity;
}

export function isPendingRole(role: string): boolean {
  return role === PENDING_ROLE;
}

/** JIT 建号：仅 SSO_ONLY 允许；必填资料安全适配，不伪造联系方式、不设公共默认密码 */
export async function provisionUser(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  identity: SsoIdentity,
  settings: SsoSettings,
  classification: string
): Promise<User> {
  const state = await getState(tx);
  const found = await findIdentityUser(tx, state, settings.ssoApiUrl, identity);
  if (found) return found;
  const originalSource = state.sourceSsoApiUrl === settings.ssoApiUrl;
  const canInitializeAdmin = originalSource && classification === "GREENFIELD" && identity.isApplicationOwner && !identity.isGlobalSuperAdmin &&
    await tx.user.count({ where: { role: "ADMIN" } }) === 0 &&
    await tx.ssoSetupAudit.count({ where: { action: "greenfield-admin" } }) === 0;
  const role = canInitializeAdmin ? "ADMIN" : PENDING_ROLE;
  let name = identity.name.slice(0, 50);
  if (await tx.user.findUnique({ where: { name } })) name = `sso_${identity.userId}_${randomBytes(4).toString("hex")}`;
  const user = await tx.user.create({ data: {
    name, email: "", department: "", password: NO_LOCAL_LOGIN_PASSWORD, role,
    // Preserve original numeric IDs; foreign-center numbers never enter the legacy unique column.
    ssoUserId: originalSource ? identity.userId : null,
  } });
  await bindIdentity(tx, user.id, settings.ssoApiUrl, identity, originalSource);
  if (canInitializeAdmin) await tx.ssoSetupAudit.create({ data: {
    action: "greenfield-admin", revision: state.revision,
    ssoActorId: identity.userId, localActorId: user.id,
    detailsJson: JSON.stringify({ source: settings.ssoApiUrl }),
  } });
  await auditProvision(tx, state, user, identity);
  return user;
}

/**
 * 解析当前请求身份：
 * - 携带 Authorization 时仅验证 SSO（失败不回退旧会话），未映射身份按阶段拒绝或 JIT 建号；
 * - 无 Authorization 时使用原 NextAuth 会话，SSO_ONLY / 维护锁下拒绝。
 */
export async function getActor(
  req: NextRequest,
  options: { business?: boolean } = {}
): Promise<Actor> {
  const hasAuthorization = req.headers.has("authorization");
  if (hasAuthorization) {
    const client = ssoClient();
    const token = getBearer(req);
    const identity = await client.verify(token);
    const state = await getState(prisma);
    if (state.maintenanceLocked) {
      fail(503, "MAINTENANCE_REQUIRED", "应用正在核对账号关联，请联系维护者");
    }
    let user = await findIdentityUser(prisma, state, ssoSettings().ssoApiUrl, identity);
    if (!user) {
      if (state.phase !== PHASES.SSO_ONLY) {
        fail(403, "LOCAL_ACCOUNT_UNMAPPED", "公司账号尚未关联原账号，请由管理员完成账号确认");
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          user = await prisma.$transaction(async (tx) => {
            const current = await getState(tx);
            if (current.maintenanceLocked) fail(503, "MAINTENANCE_REQUIRED", "应用正在核对账号关联，请稍后重试");
            if (current.phase !== PHASES.SSO_ONLY) {
              fail(403, "LOCAL_ACCOUNT_UNMAPPED", "公司账号尚未关联原账号，请由管理员完成账号确认");
            }
            return provisionUser(tx, identity, ssoSettings(), current.classification);
          });
          break;
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : null;
          if (!["P2002", "P1008", "P2028", "P2034"].includes(String(code))) throw error;
          // Another request may have created exactly this verified identity. The next transaction
          // repeats the same trusted-key lookup; it never falls back to a numeric ID or old session.
          if (attempt === 2) fail(503, "IDENTITY_BUSY", "账号正在建立，请稍后重试");
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }
      if (!user) fail(503, "IDENTITY_BUSY", "账号正在建立，请稍后重试");
    }
    return finishActor(user, "sso", options.business === true, identity);
  }

  const session = await getSession();
  const sessionUser = session?.user as
    | { id?: string; name?: string | null; role?: string }
    | undefined;
  if (!sessionUser?.id) {
    fail(401, "LOCAL_SESSION_REQUIRED", "请先登录原应用");
  }
  const state = await getState(prisma);
  if (state.phase === PHASES.SSO_ONLY) {
    fail(401, "LOCAL_SESSION_REQUIRED", "原登录方式已经关闭，请使用公司账号");
  }
  if (state.maintenanceLocked) {
    fail(503, "MAINTENANCE_REQUIRED", "应用正在核对账号关联，请联系维护者");
  }
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
  if (!user) {
    fail(401, "LOCAL_SESSION_REQUIRED", "请先登录原应用");
  }
  // 原 Cookie 写请求仍校验同源（CSRF 防线；Bearer 请求不受影响）
  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    sameOrigin(req);
  }
  return finishActor(user, "local", options.business === true);
}

async function auditProvision(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  state: Awaited<ReturnType<typeof getState>>,
  user: User,
  identity: SsoIdentity
): Promise<void> {
  const { audit } = await import("./store");
  await audit(tx, "provision", state.revision, { ssoActorId: identity.userId }, {
    local_user_id: user.id,
    role: user.role,
    source_sso_api_url: ssoSettings().ssoApiUrl,
    ding_corp_id: identity.dingCorpId,
    ding_user_id: identity.dingUserId,
  });
}

function finishActor(user: User, authMethod: "local" | "sso", business: boolean, identity?: SsoIdentity): Actor {
  if (authMethod === "sso" && user.rosterSource === ssoSettings().ssoApiUrl && user.rosterDepartment != null) {
    user = { ...user, department: user.rosterDepartment };
  }
  const view = publicUser(user);
  if (!view.is_enabled) {
    fail(403, "LOCAL_FORBIDDEN", "本地账号不存在或已停用");
  }
  const isGlobalSuperAdmin = authMethod === "sso" && identity?.isGlobalSuperAdmin === true;
  const isPending = isPendingRole(user.role) && !isGlobalSuperAdmin;
  if (business && isPending) {
    fail(403, "LOCAL_PERMISSION_PENDING", "等待应用管理员分配权限");
  }
  return {
    user: isGlobalSuperAdmin ? { ...user, role: "ADMIN" } : user,
    authMethod,
    publicUser: { ...view, is_admin: view.is_admin || isGlobalSuperAdmin },
    isPending, isGlobalSuperAdmin, ssoIdentity: identity,
  };
}

/** Recheck mutable local authorization in the same transaction as the business data. */
export async function recheckActor(tx: Prisma.TransactionClient, actor: Actor): Promise<Actor> {
  const state = await getState(tx);
  if (state.maintenanceLocked) fail(503, "MAINTENANCE_REQUIRED", "应用正在核对账号关联，请联系维护者");
  if (actor.authMethod === "local" && state.phase === PHASES.SSO_ONLY) {
    fail(401, "LOCAL_SESSION_REQUIRED", "原登录方式已经关闭，请使用公司账号");
  }
  const user = await tx.user.findUnique({ where: { id: actor.user.id } });
  if (!user) fail(403, "LOCAL_FORBIDDEN", "当前账号已不存在");
  if (actor.authMethod === "sso") {
    if (!actor.ssoIdentity) fail(401, "SSO_UNAUTHORIZED", "公司身份已失效");
    const linked = await findIdentityUser(tx, state, ssoSettings().ssoApiUrl, actor.ssoIdentity);
    if (linked?.id !== user.id) fail(409, "MAPPING_CONFLICT", "账号关联已变化，请刷新后重试");
  }
  return finishActor(user, actor.authMethod, true, actor.ssoIdentity);
}

export async function withBusinessTransaction<T>(
  req: NextRequest,
  run: (tx: Prisma.TransactionClient, actor: Actor) => Promise<T>
): Promise<T> {
  const actor = await getActor(req, { business: true });
  return prisma.$transaction(async (tx) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      // Reserve SQLite's writer before permission reads; do not retry file side effects.
      await tx.$executeRaw`UPDATE "SsoSetupState" SET "revision" = "revision" WHERE "id" = 1`;
    }
    return run(tx, await recheckActor(tx, actor));
  }, { timeout: 60000 });
}
