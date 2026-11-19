import type { OfficialGuard, SsoMode } from './types'
import type { SignOut } from './sign-out'

export type StartupMode = 'legacy' | 'setup-sso' | 'sso' | 'stopped' | 'signed-out'

export function assertMode(value: unknown): asserts value is SsoMode {
  const invalid = () => {
    throw new Error('登录模式响应无效，不能确定安全的登录方式')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const mode = value as Record<string, unknown>
  if (
    !['MAPPING_REQUIRED', 'ADMIN_VERIFICATION_REQUIRED', 'SSO_ONLY'].includes(mode.phase as string) ||
    !['GREENFIELD', 'LEGACY'].includes(mode.classification as string) ||
    !['local', 'test', 'prod'].includes(mode.environment as string) ||
    !Number.isSafeInteger(mode.revision) ||
    Number(mode.revision) < 0 ||
    typeof mode.app_id !== 'string' ||
    !/^[A-Z][A-Z0-9_]{1,31}$/.test(mode.app_id) ||
    !['legacy_login_enabled', 'jit_enabled', 'maintenance_locked'].every(
      (key) => typeof mode[key] === 'boolean'
    )
  )
    return invalid()
  if (
    mode.legacy_login_enabled !== (mode.phase !== 'SSO_ONLY' && !mode.maintenance_locked) ||
    mode.jit_enabled !== (mode.phase === 'SSO_ONLY' && !mode.maintenance_locked)
  )
    return invalid()
  for (const key of ['sso_web_url', 'sso_api_url']) {
    const raw = mode[key]
    if (typeof raw !== 'string' || !raw || /[\s\\]/.test(raw)) return invalid()
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      return invalid()
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (mode.environment === 'prod' && parsed.protocol !== 'https:')
    )
      return invalid()
  }
}

/**
 * 启动顺序：官方守卫清理 Fragment 之后才允许挂载业务 UI。
 * SSO_ONLY 下新页面访问（即使有退出标记且无凭据）也发起中心登录；
 * 退出标记只保护旧页面、后退缓存和在途请求。
 */
export async function prepareStartup(
  mode: unknown,
  url: URL,
  guard: OfficialGuard,
  intent?: Pick<SignOut, 'isSignedOut' | 'isBlocked' | 'prepareReentry'>
): Promise<StartupMode> {
  if (url.pathname === '/signed-out') return 'signed-out'
  assertMode(mode)
  if (mode.maintenance_locked) throw new Error('应用正在维护核对账号关联，请联系维护者')
  const callback = guard.readTokenCallback(url)
  const signedOut = intent?.isSignedOut()
  const resume = signedOut ? intent?.prepareReentry(callback.token) : undefined
  if (signedOut && !resume && mode.phase !== 'SSO_ONLY') return 'signed-out'
  const connecting = url.pathname === '/sso-setup'
  if (mode.phase !== 'SSO_ONLY' && !callback.token && !connecting && !resume) return 'legacy'
  const result = await guard.guardApplicationAccess({
    appId: mode.app_id,
    ssoWebUrl: mode.sso_web_url,
    ssoApiUrl: mode.sso_api_url,
    environment: mode.environment,
    currentUrl: mode.phase === 'SSO_ONLY' ? url.href : `${url.origin}/sso-setup?connect=1`,
  })
  if (result.status !== 'allowed') return 'stopped'
  if (resume ? !resume() : intent?.isBlocked()) return 'signed-out'
  return mode.phase === 'SSO_ONLY' ? 'sso' : 'setup-sso'
}
