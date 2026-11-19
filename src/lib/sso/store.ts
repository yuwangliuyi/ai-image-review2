/**
 * guided 接入状态机：阶段、revision、快照、草稿与审计的持久化操作。
 * 所有状态写操作都在事务内检查 revision；重复或陈旧请求不重复写库。
 */
import { createHash } from "crypto";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { fail } from "./errors";
import { readSsoSettings } from "./config";
import { normalizePhone } from "./phone";

export type Tx = Prisma.TransactionClient | PrismaClient;

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprint(value: unknown): string {
  return digest(JSON.stringify(sortDeep(value)));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortDeep((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

export const PHASES = {
  MAPPING_REQUIRED: "MAPPING_REQUIRED",
  ADMIN_VERIFICATION_REQUIRED: "ADMIN_VERIFICATION_REQUIRED",
  SSO_ONLY: "SSO_ONLY",
} as const;

export type SsoState = {
  id: number;
  classification: "GREENFIELD" | "LEGACY";
  phase: keyof typeof PHASES;
  revision: number;
  operatorLocalId: string | null;
  connectedSsoId: number | null;
  snapshotJson: string | null;
  mappedFingerprint: string | null;
  reviewFingerprint: string | null;
  mappedUsersJson: string | null;
  adminRevision: number | null;
  adminExpires: number | null;
  maintenanceLocked: boolean;
  rollbackAvailable: boolean;
  sourceSsoApiUrl: string | null;
  identitiesReady: boolean;
  identitySnapshotJson: string | null;
  mappedIdentityFingerprint: string | null;
};

/** 本应用管理员判定：原权限模型中仅 ADMIN 角色具备管理能力 */
export function isAdminRole(role: string): boolean {
  return role === "ADMIN";
}

export interface PublicUser {
  local_user_id: string;
  username: string;
  name: string;
  department: string;
  roles: string[];
  is_admin: boolean;
  is_enabled: boolean;
  sso_user_id: number | null;
}

export function publicUser(user: User): PublicUser {
  return {
    local_user_id: user.id,
    username: user.name,
    name: user.name,
    department: user.department,
    roles: [user.role],
    is_admin: isAdminRole(user.role),
    // 原项目没有停用概念，账号均视为启用
    is_enabled: true,
    sso_user_id: user.ssoUserId,
  };
}

export function userOrderBy(): Prisma.UserOrderByWithRelationInput[] {
  return [{ createdAt: "asc" }, { id: "asc" }];
}

/** 首次初始化：在事务内持久分类，不随重启或账号数量变化重判 */
export async function ensureState(tx: Tx): Promise<SsoState> {
  const existing = await tx.ssoSetupState.findUnique({ where: { id: 1 } });
  if (existing) {
    // An existing binding/draft is never attributed to whatever SSO happens to be configured today.
    if (!existing.sourceSsoApiUrl && !existing.connectedSsoId && !existing.snapshotJson &&
        (existing.phase === PHASES.MAPPING_REQUIRED ||
          (existing.classification === "GREENFIELD" && await tx.user.count() === 0)) &&
        await tx.user.count({ where: { ssoUserId: { not: null } } }) === 0 &&
        await tx.ssoSetupDraft.count() === 0 && await tx.ssoIdentityMapping.count() === 0) {
      return await tx.ssoSetupState.update({ where: { id: 1 }, data: {
        sourceSsoApiUrl: readSsoSettings().ssoApiUrl, identitiesReady: true,
      } }) as SsoState;
    }
    return existing as SsoState;
  }
  const userCount = await tx.user.count();
  const classification = userCount > 0 ? "LEGACY" : "GREENFIELD";
  const phase = userCount > 0 ? PHASES.MAPPING_REQUIRED : PHASES.SSO_ONLY;
  try {
    return (await tx.ssoSetupState.create({
      data: { id: 1, classification, phase,
        ...(await tx.user.count({ where: { ssoUserId: { not: null } } }) === 0
          ? { sourceSsoApiUrl: readSsoSettings().ssoApiUrl, identitiesReady: true } : {}),
      },
    })) as SsoState;
  } catch (error) {
    // 并发首次初始化：唯一主键冲突时读取已建立状态
    const raced = await tx.ssoSetupState.findUnique({ where: { id: 1 } });
    if (raced) return raced as SsoState;
    throw error;
  }
}

export async function getState(tx: Tx): Promise<SsoState> {
  const state = await ensureState(tx);
  return state;
}

export async function usersSnapshot(tx: Tx): Promise<PublicUser[]> {
  const users = await tx.user.findMany({ orderBy: userOrderBy() });
  return users.map(publicUser);
}

/** 待核对指纹：原账号资料 + 手机号（本项目无手机号字段，恒为 null） */
export async function reviewFingerprint(tx: Tx): Promise<string> {
  const users = await usersSnapshot(tx);
  const phones: Record<string, string | null> = {};
  for (const user of users) phones[user.local_user_id] = null;
  return fingerprint({ users, phones });
}

/** MAPPING_REQUIRED 阶段账号/角色变化时递增 revision，使旧草稿/页面重新核对 */
export async function refreshReview(tx: Tx): Promise<void> {
  const state = await getState(tx);
  if (state.phase !== PHASES.MAPPING_REQUIRED) return;
  const current = await reviewFingerprint(tx);
  if (state.reviewFingerprint !== current) {
    await tx.ssoSetupState.update({
      where: { id: 1 },
      data: { reviewFingerprint: current, revision: state.revision + 1 },
    });
  }
}

export interface DraftRowView {
  local_user_id: string;
  sso_user_id: number | null;
  selection_source: "manual" | "phone";
  stale: boolean;
}

export async function draftRows(tx: Tx): Promise<DraftRowView[]> {
  const saved = await tx.ssoSetupDraft.findMany();
  if (saved.length === 0) return [];
  const byId = new Map(saved.map((row) => [row.localId, row]));
  const users = await usersSnapshot(tx);
  const rows: DraftRowView[] = [];
  for (const user of users) {
    const item = byId.get(user.local_user_id);
    const source = (item?.selectionSource as "manual" | "phone") || "manual";
    const stale =
      !!item &&
      (item.accountFingerprint !== fingerprint(user) ||
        (source === "phone" && item.phoneFingerprint !== fingerprint(null)));
    rows.push({
      local_user_id: user.local_user_id,
      sso_user_id:
        user.sso_user_id !== null ? user.sso_user_id : item ? item.ssoId : null,
      selection_source: user.sso_user_id !== null ? "manual" : source,
      stale,
    });
  }
  return rows;
}

export async function clearDraft(tx: Tx): Promise<void> {
  await tx.ssoSetupDraft.deleteMany({});
}

export function checkRevision(state: SsoState, revision: number, ...phases: string[]): void {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    fail(422, "VALIDATION_ERROR", "提交的版本号不正确");
  }
  if (state.revision !== revision) {
    fail(409, "REVISION_CONFLICT", "账号确认状态已经变化，请刷新后重试");
  }
  if (phases.length > 0 && !phases.includes(state.phase)) {
    fail(409, "STATE_CONFLICT", "当前阶段不允许此操作");
  }
}

/**
 * 用户/角色变更的阶段管控（所有用户/角色入口统一执行，不能只禁用页面按钮）：
 * - ADMIN_VERIFICATION_REQUIRED：冻结；SSO_ONLY：关闭产生未关联密码账号的旧入口；
 * - 维护锁：拒绝。
 */
export function assertUserMutationAllowed(state: SsoState, options: { creation: boolean }): void {
  if (state.maintenanceLocked) {
    fail(503, "MAINTENANCE_REQUIRED", "应用正在核对账号关联，请联系维护者");
  }
  if (options.creation && state.phase === PHASES.SSO_ONLY) {
    fail(409, "STATE_CONFLICT", "本地账号创建入口已关闭，新人员由公司账号登录后自动进入待授权状态");
  }
  if (state.phase === PHASES.ADMIN_VERIFICATION_REQUIRED) {
    fail(409, "IDENTITY_FROZEN", "账号确认后暂时冻结用户变更，请先完成或撤销本批确认");
  }
}

/** SSO_ONLY 下最后一名可用管理员只计入启用且已关联的原管理员 */
export function lastAdminGuardCondition(phase: string): Prisma.UserWhereInput {
  return phase === PHASES.SSO_ONLY ? {
    ssoIdentities: { some: { OR: [{ kind: "dingtalk" }, { kind: "legacy", namespace: readSsoSettings().ssoApiUrl }] } },
  } : {};
}

export async function audit(
  tx: Tx,
  action: string,
  revision: number,
  actor: { localActorId?: string | null; ssoActorId?: number | null } = {},
  details: unknown = {}
): Promise<void> {
  await tx.ssoSetupAudit.create({
    data: {
      action,
      revision,
      localActorId: actor.localActorId ?? null,
      ssoActorId: actor.ssoActorId ?? null,
      detailsJson: JSON.stringify(details ?? {}),
    },
  });
}

/** 本项目用户表无手机号字段：返回恒为 null 的映射，推荐走手选 */
export function phoneValuesFor(users: PublicUser[]): Map<string, string | null> {
  const values = new Map<string, string | null>();
  for (const user of users) values.set(user.local_user_id, null);
  return values;
}

export { normalizePhone };
