/**
 * /api/sso-setup/* 共享的响应构建、请求解析与阶段断言。
 * 纯断言不自行开事务，由各路由在自己的事务内调用，避免 SQLite 嵌套事务死锁。
 */
import type { NextRequest } from "next/server";
import { requireSetupSource } from "./identity-mapping";
import { fail } from "./errors";
import { ssoSettings } from "./identity";
import type { RosterUser } from "./sso-client";
import {
  PHASES,
  draftRows,
  getState,
  refreshReview as refreshReviewTx,
  usersSnapshot,
  type SsoState,
  type Tx,
} from "./store";

export { PHASES, getState, usersSnapshot, draftRows };

export function modeView(state: SsoState) {
  const settings = ssoSettings();
  return {
    validation_only: process.env.AI_REVIEW_INSTANCE_MODE === "validation",
    classification: state.classification,
    phase: state.phase,
    revision: state.revision,
    maintenance_locked: state.maintenanceLocked,
    legacy_login_enabled: state.phase !== "SSO_ONLY" && !state.maintenanceLocked,
    jit_enabled: state.phase === "SSO_ONLY" && !state.maintenanceLocked,
    app_id: settings.appId,
    sso_web_url: settings.ssoWebUrl,
    sso_api_url: settings.ssoApiUrl,
    environment: settings.environment,
  };
}

export async function buildContext(tx: Tx, options: { roster?: RosterUser[]; viewerId: number | null }) {
  const state = await getState(tx);
  const users = await usersSnapshot(tx);
  const draft = await draftRows(tx);
  return {
    ...modeView(state),
    users,
    roster: options.roster ?? [],
    draft_rows: draft,
    unresolved_count: (draft.length > 0 ? draft : users).filter(
      (row) => row.sso_user_id === null
    ).length,
    connected_user_id: options.viewerId,
    current_sso_user_id: options.viewerId,
    operator_local_user_id: state.operatorLocalId,
    rollback_available:
      options.viewerId !== null &&
      state.rollbackAvailable &&
      state.phase === PHASES.ADMIN_VERIFICATION_REQUIRED,
    // 旧响应兼容字段，不再参与流程
    admin_verified: false,
    csrf_token: null,
  };
}

/** 接入接口阶段断言：维护锁 → 503；已完成 → 409 */
export function assertWizardState(state: SsoState): SsoState {
  if (state.maintenanceLocked) {
    fail(503, "MAINTENANCE_REQUIRED", "应用正在核对账号关联，请联系维护者");
  }
  if (state.phase === PHASES.SSO_ONLY) {
    fail(409, "REVISION_CONFLICT", "接入已经完成，请返回应用");
  }
  requireSetupSource(state, ssoSettings().ssoApiUrl);
  return state;
}

/** 名单内候选人校验：停用或不在名单即冲突 */
export function requireRosterUser(roster: RosterUser[], ssoId: number): RosterUser {
  const person = roster.find((person) => person.user_id === ssoId && person.status === 1);
  if (!person) {
    fail(409, "MAPPING_CONFLICT", "所选公司人员已停用或不在本应用名单，请刷新确认");
  }
  return person;
}

export async function readRevisionBody(req: NextRequest): Promise<number> {
  const body = await req.json().catch(() => null);
  const revision = (body as { revision?: unknown } | null)?.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    fail(422, "VALIDATION_ERROR", "提交的信息格式不正确");
  }
  return revision;
}

export { refreshReviewTx };
