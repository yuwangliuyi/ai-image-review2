#!/usr/bin/env node
/**
 * 维护者恢复工具（仅面向具有服务器维护权限的人；默认只预览）。
 *
 * 与参考实现 recovery.py 同一合同：
 *   --kind runtime  仅 SSO_ONLY：恢复受控原认证并回到“待负责人完成”，保留全部账号与业务数据
 *   --kind mapping  SSO_ONLY / 已保存未撤销：按本次审计前值定向还原映射，进入带维护锁的 MAPPING_REQUIRED
 *   --kind resume   解除映射核对的维护锁（须显式 --reviewed）
 *   --kind lock     暂停业务访问、进入维护锁（不改账号或映射）
 *
 * 说明：本应用旧会话为 NextAuth JWT，无法服务端吊销；维护锁与阶段检查在
 * 每个请求上拒绝旧凭据，等效于“撤销会话”。
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprint(value) {
  const sorted = (v) =>
    Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
      : v;
  return digest(JSON.stringify(sorted(value)));
}

function publicUser(user) {
  return {
    local_user_id: user.id,
    username: user.name,
    name: user.name,
    department: user.department,
    roles: [user.role],
    is_admin: user.role === 'ADMIN',
    is_enabled: true,
    sso_user_id: user.ssoUserId,
  };
}

async function usersOrdered(tx) {
  return tx.user.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}

async function recover(kind, { apply = false, expectedRevision = null } = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const state = (await tx.ssoSetupState.findUnique({ where: { id: 1 } })) ?? null;
    if (!state) throw new Error('接入状态不存在：应用尚未初始化');
    const mappings = await tx.ssoIdentityMapping.findMany({
      select: { kind: true, namespace: true, subject: true, userId: true },
      orderBy: [{ kind: 'asc' }, { namespace: 'asc' }, { subject: 'asc' }],
    });
    const snapshot = JSON.parse(state.snapshotJson || '{}');
    const users = await usersOrdered(tx);
    const views = users.map(publicUser);
    // 可恢复的管理员：启用、原密码仍可本地登录（JIT 占位密码不可用）
    const recoverable = views.filter(
      (user) =>
        user.is_admin &&
        user.is_enabled &&
        users.find((row) => row.id === user.local_user_id)?.password?.startsWith('$2')
    );
    const eligible =
      kind === 'runtime'
        ? recoverable.filter((user) => mappings.some((row) => row.userId === user.local_user_id))
        : recoverable.slice();
    eligible.sort(
      (a, b) =>
        Number(a.local_user_id !== state.operatorLocalId) -
        Number(b.local_user_id !== state.operatorLocalId)
    );

    const blockers = [];
    if (kind !== 'lock' && (!state.sourceSsoApiUrl || !state.identitiesReady)) blockers.push('请先在原 SSO 环境完成身份映射升级');
    if (kind !== 'lock' && process.env.JX_SSO_API_URL && new URL(process.env.JX_SSO_API_URL).href.replace(/\/+$/, '') !== state.sourceSsoApiUrl) blockers.push('只能在原 SSO 环境恢复账号确认');
    if (kind !== 'lock' && (state.classification !== 'LEGACY' || eligible.length === 0)) {
      blockers.push('没有启用且可使用原认证的本地管理员，禁止恢复旧登录');
    }
    if (
      kind === 'runtime' &&
      users.some((row) => row.ssoUserId !== null && (!Number.isSafeInteger(row.ssoUserId) || row.ssoUserId <= 0))
    ) {
      blockers.push('存在非法账号关联，请先由维护者检查');
    }
    if (kind === 'runtime' && state.phase !== 'SSO_ONLY') {
      blockers.push('仅已完成切换的应用可以恢复运行切换');
    }
    if (kind === 'runtime' && state.maintenanceLocked) {
      blockers.push('维护锁内必须先核对映射，不能直接恢复普通运行');
    }
    if (kind === 'resume' && (!state.maintenanceLocked || state.phase !== 'MAPPING_REQUIRED')) {
      blockers.push('只有映射核对维护状态可以恢复账号确认入口');
    }
    if (kind === 'mapping') {
      const allowed =
        state.phase === 'SSO_ONLY' ||
        (state.phase === 'ADMIN_VERIFICATION_REQUIRED' && !state.rollbackAvailable);
      if (!allowed) blockers.push('切换前请使用账号确认页撤销本批映射');
      if (state.mappedIdentityFingerprint !== fingerprint(mappings.filter((row) => Object.hasOwn(snapshot, row.userId)))) {
        blockers.push('原账号钉钉身份映射已变化，拒绝覆盖');
      }
      const audit = await tx.ssoSetupAudit.findFirst({
        where: { action: 'mapping' },
        orderBy: { id: 'desc' },
      });
      if (!snapshot || Object.keys(snapshot).length === 0 || !audit) {
        blockers.push('缺少可核对的映射快照，请由维护者调查');
      } else {
        const mapped = JSON.parse(audit.detailsJson);
        const originalUsers = JSON.parse(state.mappedUsersJson || '[]');
        const originalById = new Map(originalUsers.map((user) => [user.local_user_id, user]));
        for (const localId of Object.keys(snapshot)) {
          const row = users.find((user) => user.id === localId);
          const view = views.find((user) => user.local_user_id === localId);
          if (
            !row ||
            row.ssoUserId !== mapped[localId] ||
            JSON.stringify(view) !== JSON.stringify(originalById.get(localId))
          ) {
            blockers.push('原账号身份、角色或映射已被其他操作修改，拒绝覆盖');
            break;
          }
        }
      }
    }

    const preview = {
      phase: state.phase,
      revision: state.revision,
      kind,
      maintenance_locked: state.maintenanceLocked,
      restore_local_ids: kind === 'mapping' ? Object.keys(snapshot).sort() : [],
      preserves_all_accounts_and_business_data: true,
      applied: false,
      can_recover: blockers.length === 0,
      blockers,
      note: 'NextAuth JWT 无法服务端吊销；维护锁/阶段检查会在每个请求拒绝旧凭据',
    };
    if (!apply) return preview;
    if (expectedRevision === null) {
      throw new Error('执行恢复必须提供预览时的 revision');
    }
    if (state.revision !== expectedRevision) {
      throw new Error(`版本冲突：当前 revision=${state.revision}，预览时 revision=${expectedRevision}`);
    }
    if (blockers.length > 0) {
      const error = new Error(blockers[0]);
      error.code = 'RECOVERY_BLOCKED';
      throw error;
    }

    if (kind === 'lock') {
      await tx.ssoSetupState.update({
        where: { id: 1 },
        data: { maintenanceLocked: true, revision: state.revision + 1, adminRevision: null, adminExpires: null },
      });
    } else if (kind === 'resume') {
      await tx.ssoSetupState.update({
        where: { id: 1 },
        data: { maintenanceLocked: false, revision: state.revision + 1 },
      });
    } else {
      const operator = eligible[0];
      await tx.ssoSetupState.update({
        where: { id: 1 },
        data: {
          phase: kind === 'runtime' ? 'ADMIN_VERIFICATION_REQUIRED' : 'MAPPING_REQUIRED',
          revision: state.revision + 1,
          maintenanceLocked: kind === 'mapping',
          adminRevision: null,
          adminExpires: null,
          rollbackAvailable: false,
          mappedFingerprint: kind === 'runtime' ? fingerprint(views) : null,
          mappedIdentityFingerprint: kind === 'runtime' ? state.mappedIdentityFingerprint : null,
          operatorLocalId: operator.local_user_id,
          connectedSsoId: operator.sso_user_id,
        },
      });
      if (kind === 'mapping') {
        await tx.ssoIdentityMapping.deleteMany({ where: { userId: { in: Object.keys(snapshot) } } });
        const identities = JSON.parse(state.identitySnapshotJson || '[]');
        if (identities.length) await tx.ssoIdentityMapping.createMany({ data: identities });
        for (const [localId, previous] of Object.entries(snapshot)) {
          await tx.user.update({ where: { id: localId }, data: { ssoUserId: previous } });
        }
      }
    }
    await tx.ssoSetupDraft.deleteMany({});
    const after = await tx.ssoSetupState.findUnique({ where: { id: 1 } });
    await tx.ssoSetupAudit.create({
      data: {
        action: `recovery-${kind}`,
        revision: after.revision,
        detailsJson: JSON.stringify({ previous_revision: state.revision }),
      },
    });
    return {
      ...preview,
      revision: after.revision,
      phase: after.phase,
      maintenance_locked: after.maintenanceLocked,
      applied: true,
    };
  });
  return result;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { kind: null, apply: false, revision: null, reviewed: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--kind') options.kind = args[++i];
    else if (args[i] === '--apply') options.apply = true;
    else if (args[i] === '--revision') options.revision = Number(args[++i]);
    else if (args[i] === '--reviewed') options.reviewed = true;
    else {
      console.error(`未知参数：${args[i]}`);
      process.exit(2);
    }
  }
  if (!['runtime', 'mapping', 'resume', 'lock'].includes(options.kind)) {
    console.error('用法：node scripts/sso-recovery.mjs --kind runtime|mapping|resume|lock [--apply --revision N] [--reviewed]');
    process.exit(2);
  }
  if (options.apply && options.revision === null) {
    console.error('--apply 必须同时提供预览中的 --revision');
    process.exit(2);
  }
  if (options.kind === 'resume' && options.apply && !options.reviewed) {
    console.error('解除维护锁必须显式传 --reviewed');
    process.exit(2);
  }
  return options;
}

const options = parseArgs();
try {
  const result = await recover(options.kind, {
    apply: options.apply,
    expectedRevision: options.revision,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.code === 'RECOVERY_BLOCKED' ? error.message : `恢复失败：${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
