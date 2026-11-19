/**
 * 手机号推荐：两侧统一规范化，仅从本应用有效准入人员中精确匹配。
 * 手机号只留在后端适配层与受控中心请求中，不进入前端或业务用户响应。
 */
import type { PhoneMatchItem, RosterUser, SsoClient } from "./sso-client";
import type { PublicUser } from "./store";

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  let normalized = value.trim().replace(/ /g, "").replace(/-/g, "");
  for (const prefix of ["+86", "0086"]) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }
  return /^1[3-9][0-9]{9}$/.test(normalized) ? normalized : null;
}

export interface PhoneSuggestion {
  local_user_id: string;
  status: "matched" | "no_match" | "invalid" | "ambiguous";
  candidate: RosterUser | null;
}

export async function phoneSuggestions(
  client: SsoClient,
  token: string,
  users: PublicUser[],
  phones: Map<string, string | null>,
  selections: { local_user_id: string; sso_user_id: number | null }[]
): Promise<PhoneSuggestion[]> {
  const counts = new Map<string, number>();
  for (const value of phones.values()) {
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  const reserved = new Map<number, string>();
  for (const user of users) {
    if (user.sso_user_id !== null) reserved.set(user.sso_user_id, user.local_user_id);
  }
  for (const row of selections) {
    if (row.sso_user_id !== null && !reserved.has(row.sso_user_id)) {
      reserved.set(row.sso_user_id, row.local_user_id);
    }
  }
  const results = new Map<string, PhoneSuggestion>();
  const query: { row_key: string; phone: string | null }[] = [];
  for (const user of users) {
    const phone = phones.get(user.local_user_id) ?? null;
    let status: PhoneSuggestion["status"] | null = null;
    if (user.sso_user_id !== null) status = "no_match";
    else if (!phone) status = "invalid";
    else if ((counts.get(phone) || 0) > 1) status = "ambiguous";
    if (status) {
      results.set(user.local_user_id, { local_user_id: user.local_user_id, status, candidate: null });
    } else {
      query.push({ row_key: user.local_user_id, phone });
    }
  }
  for (let start = 0; start < query.length; start += 100) {
    const batch: PhoneMatchItem[] = await client.matchPhones(token, query.slice(start, start + 100));
    for (const item of batch) {
      const candidate = item.candidate;
      const occupied =
        candidate && (reserved.get(candidate.user_id) ?? item.row_key) !== item.row_key;
      results.set(item.row_key, {
        local_user_id: item.row_key,
        status: occupied ? "ambiguous" : item.status,
        candidate: occupied ? null : candidate,
      });
    }
  }
  const chosen = new Map<number, number>();
  for (const item of results.values()) {
    if (item.candidate) {
      chosen.set(item.candidate.user_id, (chosen.get(item.candidate.user_id) || 0) + 1);
    }
  }
  for (const item of results.values()) {
    if (item.candidate && (chosen.get(item.candidate.user_id) || 0) > 1) {
      item.status = "ambiguous";
      item.candidate = null;
    }
  }
  return users.map((user) => results.get(user.local_user_id)!);
}
