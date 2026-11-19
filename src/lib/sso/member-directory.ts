import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { fail } from './errors';
import { getActor, getBearer, recheckActor, ssoClient, ssoSettings, type Actor } from './identity';
import { getState } from './store';

function assertAccess(actor: Actor, saveProfiles: boolean) {
  if (actor.authMethod !== 'sso' || (actor.user.role !== 'ADMIN' && (saveProfiles || actor.user.role !== 'REVIEWER'))) {
    fail(403, 'LOCAL_FORBIDDEN', saveProfiles ? '需要应用管理员权限' : '需要管理员或审核员权限');
  }
}

export async function applicationMembers(req: NextRequest, saveProfiles: boolean) {
  const actor = await getActor(req, { business: true });
  assertAccess(actor, saveProfiles);
  const source = ssoSettings().ssoApiUrl;
  const started = new Date();
  // Finish pagination before opening the transaction so a slow center cannot hold the SQLite writer.
  const members = await ssoClient().roster(getBearer(req));
  const byId = new Map(members.map(person => [String(person.user_id), person]));
  const byDing = new Map<string, typeof members[number]>();
  for (const person of members) {
    if (!person.ding_corp_id || !person.ding_user_id) continue;
    const key = JSON.stringify([person.ding_corp_id, person.ding_user_id]);
    if (byDing.has(key)) fail(409, 'MAPPING_CONFLICT', '公司成员名单有重复身份，请联系维护者核对');
    byDing.set(key, person);
  }
  return prisma.$transaction(async tx => {
    if (saveProfiles) await tx.$executeRaw`UPDATE "SsoSetupState" SET "revision" = "revision" WHERE "id" = 1`;
    assertAccess(await recheckActor(tx, actor), saveProfiles);
    const state = await getState(tx);
    if (state.phase !== 'SSO_ONLY') fail(409, 'STATE_CONFLICT', '账号接入尚未完成');
    const users = await tx.user.findMany({ select: {
      id: true, department: true, email: true, role: true, createdAt: true,
      rosterStatus: true, rosterName: true, rosterDepartment: true, rosterSource: true, rosterCheckedAt: true,
      ssoIdentities: { select: { kind: true, namespace: true, subject: true } },
      _count: { select: { uploadedSpus: true, reviews: true } },
    } });
    const localByMember = new Map<number, typeof users[number]>();
    const unchangedIds: string[] = [];
    for (const user of users) {
      const legacy = state.sourceSsoApiUrl === source && user.ssoIdentities.find(k => k.kind === 'legacy' && k.namespace === source);
      const ding = user.ssoIdentities.filter(k => k.kind === 'dingtalk');
      const numeric = legacy ? byId.get(legacy.subject) : undefined;
      const portable = ding.length ? byDing.get(JSON.stringify([ding[0].namespace, ding[0].subject])) : undefined;
      if (ding.length > 1 || (numeric && ding.length && portable?.user_id !== numeric.user_id)) {
        fail(409, 'MAPPING_CONFLICT', '公司账号与本地关联不一致，请联系维护者核对');
      }
      const person = portable ?? numeric;
      if (person) {
        if (localByMember.has(person.user_id)) fail(409, 'MAPPING_CONFLICT', '同一公司成员关联了多个本地账号，请联系维护者核对');
        localByMember.set(person.user_id, user);
      }
      if (!saveProfiles) continue;
      const sameSource = user.rosterSource === source;
      if (sameSource && user.rosterCheckedAt && user.rosterCheckedAt >= started) continue;
      const status = person ? (person.status === 1 ? 'AVAILABLE' : 'DISABLED') : (legacy || ding.length ? 'NOT_LISTED' : 'UNLINKED');
      const name = person?.name ?? (sameSource ? user.rosterName : null);
      const department = person?.department === undefined
        ? (sameSource ? user.rosterDepartment : null) : person.department;
      if (sameSource && user.rosterStatus === status && user.rosterName === name && user.rosterDepartment === department) {
        unchangedIds.push(user.id);
        continue;
      }
      await tx.user.update({ where: { id: user.id }, data: {
        rosterStatus: status, rosterName: name, rosterDepartment: department, rosterSource: source, rosterCheckedAt: started,
      } });
    }
    if (unchangedIds.length) {
      await tx.user.updateMany({ where: { id: { in: unchangedIds } }, data: { rosterCheckedAt: started } });
    }
    return members.map(person => {
      const local = localByMember.get(person.user_id);
      const cachedDepartment = person.department === undefined && local?.rosterSource === source ? local.rosterDepartment : null;
      return {
        id: local?.id ?? null, ssoUserId: person.user_id, username: person.username, name: person.name,
        department: person.department ?? cachedDepartment ?? local?.department ?? '', email: local?.email ?? '',
        role: local?.role ?? 'PENDING', createdAt: local?.createdAt ?? null,
        rosterStatus: person.status === 1 ? 'AVAILABLE' : 'DISABLED', rosterCheckedAt: started,
        _count: local?._count ?? { uploadedSpus: 0, reviews: 0 },
      };
    });
  }, { timeout: 60000 });
}
