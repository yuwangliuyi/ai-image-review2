/** Persistent identity keys. Numeric IDs are never searched outside their source SSO. */
import type { SsoIdentity } from './sso-client';
import { fail } from './errors';
import type { SsoState, Tx } from './store';

export async function identitySnapshot(tx: Tx, userIds?: string[]) {
  return tx.ssoIdentityMapping.findMany({
    where: userIds ? { userId: { in: userIds } } : undefined,
    select: { kind: true, namespace: true, subject: true, userId: true },
    orderBy: [{ kind: 'asc' }, { namespace: 'asc' }, { subject: 'asc' }],
  });
}

export function requireIdentityReady(state: SsoState): void {
  if (!state.sourceSsoApiUrl || !state.identitiesReady) {
    fail(409, 'IDENTITY_MIGRATION_REQUIRED', '请维护者先在原 SSO 环境完成既有账号身份升级，再切换环境');
  }
}

/** A ready flag alone is not evidence: every preserved original numeric binding must be covered. */
export async function requireLegacyCoverage(tx: Tx, state: SsoState): Promise<void> {
  requireIdentityReady(state);
  const users = await tx.user.findMany({ where: { ssoUserId: { not: null } }, select: { id: true, ssoUserId: true } });
  const links = await tx.ssoIdentityMapping.findMany({ where: { kind: 'legacy', namespace: state.sourceSsoApiUrl! }, select: { subject: true, userId: true } });
  const bySubject = new Map(links.map((row) => [row.subject, row.userId]));
  if (users.some((user) => bySubject.get(String(user.ssoUserId)) !== user.id)) {
    fail(409, 'IDENTITY_MIGRATION_REQUIRED', '既有账号身份映射不完整，请维护者在原环境重新核对迁移');
  }
}

export function requireSetupSource(state: SsoState, apiUrl: string): void {
  requireIdentityReady(state);
  if (state.sourceSsoApiUrl !== apiUrl) {
    fail(409, 'SETUP_SOURCE_MISMATCH', '尚未完成的账号确认或恢复只能在原 SSO 环境操作');
  }
}

export async function bindIdentity(
  tx: Tx, localId: string, apiUrl: string,
  identity: { userId: number; dingCorpId: string | null; dingUserId: string | null },
  includeLegacy = true,
): Promise<void> {
  const keys = [];
  if (includeLegacy) keys.push({ kind: 'legacy', namespace: apiUrl, subject: String(identity.userId) });
  if (identity.dingCorpId && identity.dingUserId) {
    const prior = await tx.ssoIdentityMapping.findMany({ where: { userId: localId, kind: 'dingtalk' } });
    if (prior.some((row) => row.namespace !== identity.dingCorpId || row.subject !== identity.dingUserId)) {
      fail(409, 'MAPPING_CONFLICT', '原账号已有不同钉钉身份，不能自动替换');
    }
    keys.push({ kind: 'dingtalk', namespace: identity.dingCorpId, subject: identity.dingUserId });
  }
  for (const key of keys) {
    const existing = await tx.ssoIdentityMapping.findUnique({ where: { kind_namespace_subject: key } });
    if (existing && existing.userId !== localId) fail(409, 'MAPPING_CONFLICT', '该公司身份已关联其他原账号，不能自动合并');
    if (!existing) await tx.ssoIdentityMapping.create({ data: { ...key, userId: localId } });
  }
}

export async function findIdentityUser(tx: Tx, state: SsoState, apiUrl: string, identity: SsoIdentity) {
  await requireLegacyCoverage(tx, state);
  const originalSource = state.sourceSsoApiUrl === apiUrl;
  if (state.phase !== 'SSO_ONLY' && !originalSource) requireSetupSource(state, apiUrl);
  const legacy = originalSource ? await tx.ssoIdentityMapping.findUnique({
    where: { kind_namespace_subject: { kind: 'legacy', namespace: apiUrl, subject: String(identity.userId) } },
    include: { user: { include: { ssoIdentities: true } } },
  }) : null;
  const hasDingTalk = identity.dingCorpId !== null && identity.dingUserId !== null;
  if (hasDingTalk) {
    const portable = await tx.ssoIdentityMapping.findUnique({
      where: { kind_namespace_subject: { kind: 'dingtalk', namespace: identity.dingCorpId!, subject: identity.dingUserId! } },
      include: { user: true },
    });
    if (portable) {
      if (legacy && legacy.userId !== portable.userId) fail(409, 'MAPPING_CONFLICT', '当前中心数字账号与钉钉身份关联冲突');
      return portable.user;
    }
  }
  if (legacy) {
    const bound = legacy.user.ssoIdentities.filter((row) => row.kind === 'dingtalk');
    // A trusted binding cannot be replaced by another person or downgraded to numeric-only.
    if (bound.length > 0) fail(409, 'MAPPING_CONFLICT', '当前钉钉身份与原账号关联不一致，请联系维护者');
    // An originally manual account stays numeric-only until an explicit trusted migration.
    return legacy.user;
  }
  if (!hasDingTalk && !originalSource) {
    fail(403, 'DINGTALK_IDENTITY_REQUIRED', '未绑定钉钉的账号请使用原 SSO 环境登录');
  }
  return null;
}
