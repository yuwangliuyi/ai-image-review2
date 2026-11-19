'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useSession } from 'next-auth/react'
import {
  ApiError,
  createApi,
  type Identity,
} from '@/lib/sso/frontend/transport'
import { getSsoStorageKey } from '@/lib/sso/frontend/storage-keys'
import { createSignOut, SignedOutError, type SignOut } from '@/lib/sso/frontend/sign-out'
import { prepareStartup, assertMode } from '@/lib/sso/frontend/startup'
import { loadOfficialGuard } from '@/lib/sso/frontend/guard-loader'
import { registerSsoFetchState } from '@/lib/sso/frontend/app-fetch'
import type { OfficialGuard, SsoMode } from '@/lib/sso/frontend/types'

export interface AppUser {
  id: string
  name: string
  role: string
  department: string
  isPending: boolean
  isGlobalSuperAdmin?: boolean
}

export type AppPhase = 'booting' | 'legacy' | 'sso' | 'stopped' | 'maintenance' | 'error'

interface SsoAppValue {
  phase: AppPhase
  mode: SsoMode | null
  user: AppUser | null
  /** 统一业务请求器：自动附加 SSO Bearer / 原会话 Cookie，并统一处理 401 */
  api: <T>(path: string, options?: Omit<Parameters<ReturnType<typeof createApi>>[1], 'identity'>) => Promise<T>
  /** FormData 等原始体上传（SSO 模式仍附加 Bearer） */
  apiRaw: (path: string, init: RequestInit) => Promise<Response>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  errorMessage: string
  retry: () => void
}

const SsoAppContext = createContext<SsoAppValue | null>(null)

export function useSsoApp(): SsoAppValue {
  const value = useContext(SsoAppContext)
  if (!value) throw new Error('useSsoApp 必须在 SsoAppGate 内使用')
  return value
}

/**
 * 启动门卫：在官方守卫清理 Fragment、完成中心校验之前不挂载业务 UI。
 * /signed-out 是公开停留页，早于模式查询与守卫呈现。
 */
export default function SsoAppGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AppPhase>('booting')
  const [mode, setMode] = useState<SsoMode | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [bootNonce, setBootNonce] = useState(0)
  const [signOut, setSignOut] = useState<SignOut | null>(null)
  const [guard, setGuard] = useState<OfficialGuard | null>(null)
  // 客户端路由切换不重跑启动：只在页面加载时判定一次
  const bootedRef = useRef(false)
  const isSignedOutPage =
    typeof window !== 'undefined' && window.location.pathname === '/signed-out'
  const isSetupPage =
    typeof window !== 'undefined' && window.location.pathname === '/sso-setup'
  // 未完成接入时，负责人向导只要求公司身份，不要求已有本地账号。
  const needsBusinessIdentity = !isSetupPage || mode?.phase === 'SSO_ONLY'

  const { data: legacySession } = useSession()

  const retry = useCallback(() => {
    bootedRef.current = false
    setUser(null)
    setErrorMessage('')
    setPhase('booting')
    setBootNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (bootedRef.current || isSignedOutPage) return
    bootedRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/auth/mode', {
          credentials: 'omit',
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('登录模式服务暂不可用')
        const mode = await response.json()
        assertMode(mode)
        if (cancelled) return
        const loadedGuard = await loadOfficialGuard()
        if (cancelled) return
        const createdSignOut = createSignOut(mode.app_id, window, mode.sso_api_url)
        createdSignOut.listen(() => setUser(null))
        const startup = mode.maintenance_locked
          ? 'maintenance'
          : await prepareStartup(mode, new URL(window.location.href), loadedGuard, createdSignOut)
        if (cancelled) return
        if (startup === 'signed-out') {
          createdSignOut.show()
        }
        if (startup === 'maintenance') {
          setMode(mode)
          setPhase('maintenance')
          return
        }
        if (startup === 'signed-out' || startup === 'stopped') {
          setPhase('stopped')
          return
        }
        const nextPhase = startup === 'sso' || startup === 'setup-sso' ? 'sso' : 'legacy'
        setSignOut(createdSignOut)
        setGuard(loadedGuard)
        setMode(mode)
        setPhase(nextPhase)
        // 页面级统一请求器：SSO 模式只向同源 /api/ 附加 Bearer
        registerSsoFetchState({
          phase: nextPhase,
          getToken: () => window.localStorage.getItem(getSsoStorageKey(mode.app_id, mode.sso_api_url)),
          signOut: createdSignOut,
          guard: loadedGuard,
        })
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : '暂时无法确认登录状态')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
    // guard/signOut 由本效果创建并写入 state，不作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootNonce, isSignedOutPage])

  // legacy 模式下用户来自原 NextAuth 会话（派生，不额外同步 state）
  const legacyUser: AppUser | null = useMemo(() => {
    if (phase !== 'legacy' || !legacySession?.user) return null
    const raw = legacySession.user as { id?: string; name?: string | null; role?: string; department?: string }
    return {
      id: raw.id || '',
      name: raw.name || '',
      role: raw.role || 'UPLOADER',
      department: raw.department || '',
      isPending: false,
    }
  }, [phase, legacySession])

  const getToken = useCallback(
    () => (mode ? window.localStorage.getItem(getSsoStorageKey(mode.app_id, mode.sso_api_url)) : null),
    [mode]
  )

  const assertActive = useCallback(() => signOut?.assertActive(), [signOut])

  const baseApi = useMemo(
    () =>
      createApi({
        origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
        fetcher: (input, init) => fetch(input, init),
        getToken,
        assertActive,
      }),
    [getToken, assertActive]
  )

  const identity: Identity = phase === 'sso' ? 'sso' : 'local'

  const api = useCallback(
    async <T,>(path: string, options: Omit<Parameters<typeof baseApi>[1], 'identity'> = {}) => {
      try {
        return await baseApi<T>(path, { ...options, identity })
      } catch (error) {
        handleApiFailure(error, guard, signOut)
        throw error
      }
    },
    [baseApi, identity, guard, signOut]
  )

  const apiRaw = useCallback(
    async (path: string, init: RequestInit) => {
      const target = new URL(path, window.location.origin)
      if (path.startsWith('//') || target.origin !== window.location.origin || !target.pathname.startsWith('/api/')) {
        throw new Error('只允许同源 /api/ 请求')
      }
      const headers = new Headers(init.headers || {})
      if (phase === 'sso') {
        const token = getToken()
        headers.set('Authorization', token ? `Bearer ${token}` : 'Bearer')
      }
      const response = await fetch(target.href, {
        ...init,
        credentials: phase === 'sso' ? 'omit' : 'same-origin',
        cache: 'no-store',
        headers,
      })
      if (response.status === 401) {
        handleApiFailure(
          new ApiError(
            401,
            phase === 'sso' ? 'SSO_UNAUTHORIZED' : 'LOCAL_SESSION_REQUIRED',
            '登录已失效',
            phase === 'sso' ? 'sso' : 'local'
          ),
          guard,
          signOut
        )
      }
      return response
    },
    [phase, getToken, guard, signOut]
  )

  const refreshUser = useCallback(async () => {
    if (phase !== 'sso' || !mode || !needsBusinessIdentity) return
    try {
      const me = await baseApi<{
        local_user_id: string
        name: string
        department?: string
        roles: string[]
        is_pending: boolean
        is_admin?: boolean
        is_global_super_admin?: boolean
      }>('/api/auth/me', { identity: 'sso' })
      setUser({
        id: me.local_user_id,
        name: me.name,
        role: me.is_admin === true ? 'ADMIN' : me.roles[0] || 'PENDING',
        department: me.department || '',
        isPending: me.is_pending,
        isGlobalSuperAdmin: me.is_global_super_admin === true,
      })
    } catch (error) {
      if (error instanceof SignedOutError) return
      setUser(null)
      handleApiFailure(error, guard, signOut)
      setErrorMessage(error instanceof Error ? error.message : '暂时无法读取应用账号，请稍后重试')
      setPhase('error')
    }
  }, [baseApi, mode, phase, guard, signOut, needsBusinessIdentity])

  useEffect(() => {
    if (phase !== 'sso') return
    const timer = setTimeout(() => {
      void refreshUser()
    }, 0)
    return () => clearTimeout(timer)
  }, [phase, refreshUser])

  const logout = useCallback(async () => {
    if (!mode) return
    if (phase === 'sso' && signOut) {
      signOut.begin()
      try {
        await baseApi<{ message: string }>('/api/auth/logout', {
          identity: 'sso',
          method: 'POST',
          body: {},
        })
        setUser(null)
        signOut.complete(mode.sso_web_url)
      } catch (error) {
        // 401 已由后端幂等清理；其余错误保留状态可重试，不触发自动登录
        signOut.failed()
        throw error
      }
    }
  }, [baseApi, mode, phase, signOut])

  const effectiveUser = phase === 'legacy' ? legacyUser : user
  const value = useMemo<SsoAppValue>(
    () => ({ phase, mode, user: effectiveUser, api, apiRaw, logout, refreshUser, errorMessage, retry }),
    [phase, mode, effectiveUser, api, apiRaw, logout, refreshUser, errorMessage, retry]
  )

  if (isSignedOutPage) {
    return <SsoAppContext.Provider value={value}>{children}</SsoAppContext.Provider>
  }
  if (phase === 'booting' || (phase === 'sso' && needsBusinessIdentity && !user)) {
    return <FullScreenSpinner label="正在确认登录状态…" />
  }
  if (phase === 'error') {
    return (
      <FullScreenMessage
        title="暂时无法确认登录状态"
        description={errorMessage || '请检查服务后重试。'}
        action={<button onClick={retry}>重试</button>}
      />
    )
  }
  if (phase === 'maintenance') {
    return (
      <FullScreenMessage
        title="应用维护中"
        description="应用正在核对账号关联，请联系维护者。"
      />
    )
  }
  if (phase === 'stopped') return null
  return <SsoAppContext.Provider value={value}>{children}</SsoAppContext.Provider>
}

function handleApiFailure(error: unknown, guard: OfficialGuard | null, signOut: SignOut | null) {
  if (error instanceof SignedOutError) return
  if (!(error instanceof ApiError) || error.status !== 401) return
  if (signOut?.isBlocked()) return
  if (error.source === 'sso') {
    // 仅 SSO 失效调用官方 onUnauthorized；退出进行中/主动退出后禁止自动重登
    guard?.onUnauthorized({ status: 401 })
  } else {
    window.location.replace('/login')
  }
}

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--color-bg)' }}>
      <div
        className="w-8 h-8 rounded-full animate-spin"
        style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-accent)' }}
      />
      <div className="text-sm" style={{ color: 'var(--color-muted)' }}>{label}</div>
    </div>
  )
}

function FullScreenMessage({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-bg)' }}>
      <div role="alert" className="w-full max-w-md p-8 rounded-xl text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-fg)' }}>{title}</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}
