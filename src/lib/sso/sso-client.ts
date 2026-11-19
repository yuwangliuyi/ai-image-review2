/**
 * 中心 SSO 客户端：严格校验当前中心合同响应，未知或矛盾响应一律拒绝使用。
 * Bearer Token 只在此处使用，不入库、不写日志。
 */
import { fail } from "./errors";
import type { SsoSettings } from "./config";

const REQUEST_TIMEOUT_MS = 10_000;

export interface SsoIdentity {
  userId: number;
  username: string;
  name: string;
  dingCorpId: string | null;
  dingUserId: string | null;
  isApplicationOwner: boolean;
  isGlobalSuperAdmin: boolean;
}

export interface RosterUser {
  department?: string | null;
  user_id: number;
  username: string;
  name: string;
  status: 0 | 1;
  access_source: string;
  ding_corp_id: string | null;
  ding_user_id: string | null;
}

export interface PhoneMatchItem {
  row_key: string;
  status: "matched" | "no_match" | "invalid" | "ambiguous";
  candidate: RosterUser | null;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
}

function profile(data: Record<string, unknown>): { username: string; name: string } {
  for (const key of ["username", "name"]) {
    if (data[key] !== undefined && data[key] !== null && typeof data[key] !== "string") {
      fail(503, "SSO_UNAVAILABLE", "公司人员资料字段格式不正确");
    }
  }
  const username = String(data.username ?? "").trim() || `sso_${data.user_id}`;
  return { username, name: String(data.name ?? "").trim() || username };
}

function rosterDepartment(value: unknown): string | null {
  if (!value || typeof value !== "object") fail(503, "SSO_UNAVAILABLE", "中心尚未提供组织资料");
  const org = value as { departments?: unknown; observed_at?: unknown; primary_department?: unknown };
  if (!Array.isArray(org.departments) || !(org.observed_at === null || typeof org.observed_at === "string")) {
    fail(503, "SSO_UNAVAILABLE", "组织资料不完整");
  }
  const paths = org.departments.map(dept => {
    const path = typeof dept?.full_path === "string" ? dept.full_path.trim() : "";
    const name = typeof dept?.department_name === "string" ? dept.department_name.trim() : "";
    if (!path && !name) fail(503, "SSO_UNAVAILABLE", "部门缺少名称或路径");
    return path || name;
  });
  // A manual account with no organization source keeps its historical department.
  return paths.length || org.observed_at ? paths.join("、") : null;
}

export const IDENTITY_CONTRACT = "dingtalk-v1";

export function dingTalkPair(data: Record<string, unknown>) {
  const corp = data.ding_corp_id;
  const user = data.ding_user_id;
  const valid = (value: unknown, max: number): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\x00-\x1f\x7f]/.test(value);
  if (corp === null && user === null) return { ding_corp_id: null, ding_user_id: null };
  if (!valid(corp, 64) || !valid(user, 128)) fail(503, "SSO_UNAVAILABLE", "公司钉钉身份字段不完整或不合法");
  return { ding_corp_id: corp, ding_user_id: user };
}

function requireContract(data: Record<string, unknown>) {
  if (data.identity_contract !== IDENTITY_CONTRACT) {
    fail(503, "SSO_IDENTITY_CONTRACT_REQUIRED", "公司登录服务尚不支持钉钉身份协议，请先升级 SSO");
  }
}

export interface ResolvedIdentity {
  user_id: number;
  found: boolean;
  ding_corp_id: string | null;
  ding_user_id: string | null;
}

export class SsoClient {
  constructor(private settings: SsoSettings) {}

  private async request(
    method: "GET" | "POST",
    path: string,
    token: string,
    body?: unknown
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${this.settings.ssoApiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-JX-SSO-Identity": IDENTITY_CONTRACT,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      fail(503, "SSO_UNAVAILABLE", "暂时无法连接公司登录服务，请稍后重试");
    }
    if (response.status === 401) {
      fail(401, "SSO_UNAUTHORIZED", "公司登录已失效，请重新登录");
    }
    if (response.status === 403) {
      fail(403, "SSO_FORBIDDEN", "公司账号没有本应用访问权限");
    }
    if (response.status === 429) {
      fail(503, "SSO_UNAVAILABLE", "手机号推荐请求过于频繁，请稍后重试");
    }
    if (!(response.status >= 200 && response.status < 300)) {
      fail(503, "SSO_UNAVAILABLE", "公司登录服务暂时不可用");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      fail(503, "SSO_UNAVAILABLE", "公司登录服务返回格式不正确");
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { code?: unknown }).code !== "number"
    ) {
      fail(503, "SSO_UNAVAILABLE", "公司登录服务返回格式不正确");
    }
    const coded = payload as { code: number };
    if (coded.code === 401) {
      fail(401, "SSO_UNAUTHORIZED", "公司登录已失效，请重新登录");
    }
    if (coded.code === 403) {
      fail(403, "SSO_FORBIDDEN", "公司账号没有本应用访问权限");
    }
    if (coded.code !== 0) {
      fail(503, "SSO_UNAVAILABLE", "公司登录服务暂时不可用");
    }
    const data = (payload as { data?: unknown }).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail(503, "SSO_UNAVAILABLE", "公司登录服务返回格式不正确");
    }
    return data as Record<string, unknown>;
  }

  /** GET /sso/auth/verify：独立校验身份与应用准入（守卫不替代后端鉴权） */
  async verify(token: string): Promise<SsoIdentity> {
    const data = await this.request(
      "GET",
      `/auth/verify?app_id=${encodeURIComponent(this.settings.appId)}`,
      token
    );
    requireContract(data);
    if (data.is_global_super_admin !== undefined && typeof data.is_global_super_admin !== "boolean") {
      fail(503, "SSO_UNAVAILABLE", "公司全局权限字段格式不正确");
    }
    if (
      typeof data.is_application_owner !== "boolean" ||
      data.app_id !== this.settings.appId ||
      data.application_allowed !== true ||
      !positive(data.user_id)
    ) {
      fail(503, "SSO_UNAVAILABLE", "公司身份校验返回不符合契约");
    }
    const pair = dingTalkPair(data);
    return { userId: data.user_id as number, ...profile(data), dingCorpId: pair.ding_corp_id,
      dingUserId: pair.ding_user_id, isApplicationOwner: data.is_application_owner as boolean,
      isGlobalSuperAdmin: data.is_global_super_admin === true };
  }

  /** GET /sso/app/users：完整遍历分页名单 */
  async roster(token: string): Promise<RosterUser[]> {
    const users: RosterUser[] = [];
    const seen = new Set<number>();
    let expectedTotal: number | null = null;
    let pageNo = 1;
    const pageSize = 100;
    for (;;) {
      const data = await this.request(
        "GET",
        `/app/users?app_id=${encodeURIComponent(this.settings.appId)}&page_no=${pageNo}&page_size=${pageSize}`,
        token
      );
      requireContract(data);
      if (!Array.isArray(data.records)) {
        fail(503, "SSO_UNAVAILABLE", "公司人员名单格式不正确");
      }
      const total = data.total_count;
      const pages = data.total_page;
      if (
        typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 ||
        pages !== Math.ceil(total / pageSize) ||
        data.page_no !== pageNo ||
        data.page_size !== pageSize ||
        (expectedTotal !== null && expectedTotal !== total)
      ) {
        fail(503, "SSO_UNAVAILABLE", "公司人员名单分页不完整或已经变化，请重试");
      }
      expectedTotal = total;
      const records = data.records as Record<string, unknown>[];
      if (records.length !== Math.min(pageSize, Math.max(0, total - users.length))) {
        fail(503, "SSO_UNAVAILABLE", "公司人员名单缺页，请重试");
      }
      for (const item of records) {
        if (
          !item || typeof item !== "object" ||
          !positive(item.user_id) ||
          seen.has(item.user_id as number) ||
          typeof item.status !== "number" ||
          ![0, 1].includes(item.status as number) ||
          (item.access_source !== "ROLE" && item.access_source !== "SUPER_ADMIN")
        ) {
          fail(503, "SSO_UNAVAILABLE", "公司人员名单字段不符合契约");
        }
        seen.add(item.user_id as number);
        users.push({
          user_id: item.user_id as number,
          status: item.status as 0 | 1,
          access_source: item.access_source as string,
          ...(item.organization === undefined ? {} : { department: rosterDepartment(item.organization) }),
          ...profile(item),
          ...dingTalkPair(item),
        });
      }
      if (users.length === total) return users;
      pageNo += 1;
    }
  }

  async resolveIdentities(token: string, userIds: number[]): Promise<ResolvedIdentity[]> {
    if (!userIds.length || userIds.length > 100 || userIds.some((id) => !positive(id)) || new Set(userIds).size !== userIds.length) {
      fail(422, "VALIDATION_ERROR", "身份解析每批需要 1 至 100 个不重复的正整数 ID");
    }
    const data = await this.request("POST", "/app/users/resolve-identities", token, {
      app_id: this.settings.appId, user_ids: userIds,
    });
    requireContract(data);
    const expected = new Set(userIds);
    if (!Array.isArray(data.records) || data.records.length !== userIds.length) {
      fail(503, "SSO_UNAVAILABLE", "身份解析响应不完整");
    }
    return data.records.map((raw: Record<string, unknown>, index: number) => {
      if (!raw || !positive(raw.user_id) || !expected.delete(raw.user_id) || raw.user_id !== userIds[index] || typeof raw.found !== "boolean") {
        fail(503, "SSO_UNAVAILABLE", "身份解析响应不符合契约");
      }
      const pair = dingTalkPair(raw);
      if (!raw.found && pair.ding_corp_id !== null) fail(503, "SSO_UNAVAILABLE", "身份解析响应矛盾");
      return { user_id: raw.user_id, found: raw.found, ...pair };
    });
  }

  /** POST /sso/auth/logout：撤销当前凭据账号的所有设备会话，不接受目标 user_id */
  async logout(token: string): Promise<void> {
    await this.request("POST", "/auth/logout", token, {
      app_id: this.settings.appId,
      scope: "all",
    });
  }

  /** POST /sso/app/users/match-phone：受限手机号推荐 */
  async matchPhones(token: string, rows: { row_key: string; phone: string | null }[]): Promise<PhoneMatchItem[]> {
    const data = await this.request("POST", "/app/users/match-phone", token, {
      app_id: this.settings.appId,
      rows,
    });
    requireContract(data);
    const records = data.records;
    if (!Array.isArray(records) || records.length !== rows.length) {
      fail(503, "SSO_UNAVAILABLE", "手机号推荐响应不完整，请暂时手动选择");
    }
    const expected = new Set(rows.map((row) => row.row_key));
    const result: PhoneMatchItem[] = [];
    for (const item of records as Record<string, unknown>[]) {
      if (
        !item || typeof item !== "object" ||
        typeof item.row_key !== "string" ||
        !expected.has(item.row_key) ||
        !["matched", "no_match", "invalid", "ambiguous"].includes(item.status as string)
      ) {
        fail(503, "SSO_UNAVAILABLE", "手机号推荐响应格式不正确，请暂时手动选择");
      }
      expected.delete(item.row_key as string);
      let candidate: RosterUser | null = null;
      if (item.status === "matched") {
        const raw = item.candidate as Record<string, unknown> | null | undefined;
        if (
          !raw ||
          !positive(raw.user_id) ||
          raw.status !== 1 ||
          (raw.access_source !== "ROLE" && raw.access_source !== "SUPER_ADMIN")
        ) {
          fail(503, "SSO_UNAVAILABLE", "手机号推荐候选无效，请暂时手动选择");
        }
        candidate = {
          user_id: raw.user_id as number,
          status: 1,
          access_source: raw.access_source as string,
          ...profile(raw),
          ...dingTalkPair(raw),
        };
      } else if (item.candidate != null) {
        fail(503, "SSO_UNAVAILABLE", "手机号推荐响应矛盾，请暂时手动选择");
      }
      result.push({
        row_key: item.row_key as string,
        status: item.status as PhoneMatchItem["status"],
        candidate,
      });
    }
    return result;
  }
}
