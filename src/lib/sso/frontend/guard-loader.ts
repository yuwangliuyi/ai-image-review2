import type { OfficialGuard } from './types'

/**
 * 加载官方守卫分发文件 /jx-sso/jx-sso-guard.js（与接入包 browser/ 逐字节一致，
 * 校验清单见 public/jx-sso/CHECKSUMS.txt）。禁止手写、裁剪或分叉守卫。
 */
let loading: Promise<OfficialGuard> | null = null

export function loadOfficialGuard(): Promise<OfficialGuard> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('守卫只能在浏览器环境运行'))
  }
  if (window.JxSsoGuard) {
    return window.JxSsoGuard.JX_SSO_GUARD_VERSION === '2.2.0'
      ? Promise.resolve(window.JxSsoGuard)
      : Promise.reject(new Error('官方守卫版本已更新，请刷新页面'))
  }
  loading ??= new Promise<OfficialGuard>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-jx-sso-guard]')
    const script = existing ?? document.createElement('script')
    const done = () => {
      const guard = window.JxSsoGuard
      if (!guard || guard.JX_SSO_GUARD_VERSION !== '2.2.0') {
        reject(new Error('官方守卫加载失败或版本不正确'))
        return
      }
      resolve(guard)
    }
    script.addEventListener('load', done)
    script.addEventListener('error', () => reject(new Error('官方守卫加载失败')))
    if (!existing) {
      script.src = '/jx-sso/jx-sso-guard.js'
      script.dataset.jxSsoGuard = '1'
      document.head.appendChild(script)
    }
  })
  return loading
}
