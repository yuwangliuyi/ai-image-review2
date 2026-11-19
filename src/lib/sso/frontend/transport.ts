export type Identity = 'public' | 'local' | 'sso'

export class ApiError extends Error {
  readonly source: 'local' | 'sso' | 'request'
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    identity: Identity
  ) {
    super(message)
    this.source =
      code.startsWith('SSO_')
        ? 'sso'
        : code === 'LOCAL_SESSION_REQUIRED'
          ? 'local'
          : status === 401
            ? identity === 'sso'
              ? 'sso'
              : 'local'
            : 'request'
  }
}

interface RequestOptions {
  identity: Identity
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** FormData 上传等场景直接透传 */
  rawBody?: BodyInit
}

export function createApi(deps: {
  origin: string
  fetcher: typeof fetch
  getToken: () => string | null
  assertActive?: () => void
}) {
  const { fetcher } = deps
  return async function api<T>(path: string, options: RequestOptions): Promise<T> {
    // Bearer 目标白名单：只允许同源 /api/ 请求
    const target = new URL(path, deps.origin)
    if (path.startsWith('//') || target.origin !== deps.origin || !target.pathname.startsWith('/api/')) {
      throw new Error('只允许同源 /api/ 请求')
    }
    const method = options.method ?? (options.body === undefined && options.rawBody === undefined ? 'GET' : 'POST')
    const isLogout = method === 'POST' && target.pathname === '/api/auth/logout'
    const assertActive = () => {
      if (options.identity !== 'public' && !isLogout) deps.assertActive?.()
    }
    assertActive()
    const headers = new Headers({ Accept: 'application/json' })
    const usesSso = options.identity === 'sso'
    if (usesSso) {
      const token = deps.getToken()
      if (!token && !isLogout) throw new ApiError(401, 'SSO_UNAUTHORIZED', '请先连接佳选账号', options.identity)
      // 明确空 Bearer 仍为 SSO 退出，不回退旧身份；后端幂等清当前浏览器的 Cookie。
      headers.set('Authorization', token ? `Bearer ${token}` : 'Bearer')
    }
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }
    // 退出仍只靠 Bearer 鉴权；此唯一例外允许后端撤销并清除本浏览器残留的旧会话。
    const clearsBrowserSessions = options.identity === 'sso' && isLogout
    const response = await fetcher(target.href, {
      method,
      credentials: (options.identity === 'sso' && !clearsBrowserSessions) || options.identity === 'public' ? 'omit' : 'same-origin',
      cache: 'no-store',
      headers: options.rawBody !== undefined && usesSso ? withBearer(headers, deps.getToken()) : headers,
      body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })
    const data = await response.json().catch(() => null)
    // 拒绝退出前已发出、退出后才回来的响应，包括会引起自动重登的迟到 401。
    assertActive()
    if (!response.ok) {
      const detail = (data as { detail?: { code?: unknown; message?: unknown } } | null)?.detail
      throw new ApiError(
        response.status,
        typeof detail?.code === 'string' ? detail.code : 'REQUEST_FAILED',
        typeof detail?.message === 'string' ? detail.message : '请求未完成，请稍后重试',
        options.identity
      )
    }
    return data as T
  }
}

function withBearer(headers: Headers, token: string | null): Headers {
  headers.set('Authorization', token ? `Bearer ${token}` : 'Bearer')
  return headers
}

export type ApiClient = ReturnType<typeof createApi>
