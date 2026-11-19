import type { OfficialGuard } from './types'
import type { SignOut } from './sign-out'

/**
 * 页面级统一请求器：与 fetch 同签名，业务页面用它替换裸 fetch。
 * 仅当处于 SSO 模式且目标是同源 /api/ 路径时附加 Bearer（目标白名单），
 * 跨源绝对地址与第三方目标不携带 Token；准备阶段继续使用原会话 Cookie。
 */
interface SsoFetchState {
  phase: 'legacy' | 'sso'
  getToken: () => string | null
  signOut: SignOut | null
  guard: OfficialGuard | null
}

let state: SsoFetchState | null = null

export function registerSsoFetchState(next: SsoFetchState) {
  state = next
}

export async function ssoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!state) {
    // 启动门卫未完成前不应发生业务请求；按原样转发，不附加任何凭据
    return fetch(input, init)
  }
  const requestUrl =
    typeof input === 'string' || input instanceof URL
      ? new URL(String(input), window.location.origin)
      : new URL((input as Request).url)
  const usesSso =
    state.phase === 'sso' &&
    !String(input).startsWith('//') &&
    requestUrl.origin === window.location.origin &&
    requestUrl.pathname.startsWith('/api/')
  const headers = new Headers(init?.headers || {})
  let token: string | null = null
  if (usesSso) {
    token = state.getToken()
    headers.set('Authorization', token ? `Bearer ${token}` : 'Bearer')
  }
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: usesSso ? 'omit' : init?.credentials,
  })
  if (response.status === 401 && usesSso && !state.signOut?.isBlocked()) {
    // 仅 SSO 失效调用官方 onUnauthorized；退出进行中/主动退出后禁止自动重登
    state.guard?.onUnauthorized({ status: 401 })
  }
  return response
}
