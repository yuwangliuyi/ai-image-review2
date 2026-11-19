// ADMIN_VERIFICATION_REQUIRED 保留旧持久化值；v4 语义为“待负责人完成”。
export type Phase = 'MAPPING_REQUIRED' | 'ADMIN_VERIFICATION_REQUIRED' | 'SSO_ONLY'

export interface SsoMode {
  validation_only?: boolean
  classification: 'GREENFIELD' | 'LEGACY'
  phase: Phase
  revision: number
  legacy_login_enabled: boolean
  jit_enabled: boolean
  maintenance_locked: boolean
  app_id: string
  sso_web_url: string
  sso_api_url: string
  environment: 'local' | 'test' | 'prod'
}

export interface LocalUser {
  local_user_id: string
  username: string
  name: string
  department?: string
  roles: string[]
  is_admin: boolean
  is_enabled: boolean
  sso_user_id: number | null
}

export interface SessionUser extends LocalUser {
  auth_method: 'local' | 'sso'
  is_pending: boolean
  csrf_token?: string | null
}

export interface RosterUser {
  user_id: number
  username: string
  name: string
  department?: string | null
  status: 0 | 1
  access_source: string
}

export interface SetupContext extends SsoMode {
  users: LocalUser[]
  roster: RosterUser[]
  current_sso_user_id?: number | null
  connected_user_id: number | null
  operator_local_user_id: string | null
  admin_verified: boolean
  rollback_available: boolean
  csrf_token: string | null
  draft_rows?: (DraftRow & { stale?: boolean })[]
  unresolved_count?: number
}

export interface DraftRow {
  local_user_id: string
  sso_user_id: number | null
  selection_source: 'manual' | 'phone'
}

export interface MappingRow extends DraftRow {
  saved?: boolean
  edited?: boolean
  stale?: boolean
  issue?: string
}

export interface PhoneSuggestions {
  revision: number
  available: boolean
  message: string
  suggestions: {
    local_user_id: string
    status: 'matched' | 'no_match' | 'invalid' | 'ambiguous'
    candidate: RosterUser | null
  }[]
}

// 描述调用方用到的公开接口；实现始终加载 /jx-sso/jx-sso-guard.js 官方分发文件。
export interface OfficialGuard {
  JX_SSO_GUARD_VERSION: string
  getSsoStorageKey(appId: string, ssoApiUrl: string): string
  readTokenCallback(location: Pick<Location, 'hash'>): { token: string; redirect: string }
  guardApplicationAccess(options: {
    appId: string
    ssoWebUrl: string
    ssoApiUrl: string
    environment: 'local' | 'test' | 'prod'
    currentUrl?: string
  }): Promise<{ status: 'allowed' | 'redirecting' | 'forbidden'; data?: unknown }>
  onUnauthorized(response: { status: number }): boolean
}

declare global {
  interface Window {
    JxSsoGuard?: OfficialGuard
  }
}
