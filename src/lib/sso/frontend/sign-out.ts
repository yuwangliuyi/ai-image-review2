import { ssoStorageKeys } from "./storage-keys"

export class SignedOutError extends Error {
  constructor() {
    super('已退出当前应用，请明确点击“重新进入”后继续。')
  }
}

export function createSignOut(
  appId: string,
  browser: Window,
  ssoApiUrl: string,
  navigate = (path: string) => browser.location.replace(path)
) {
  const keys = ssoStorageKeys(appId, ssoApiUrl)
  const key = keys.signedOut
  let exiting = false
  const isSignedOut = () => browser.localStorage.getItem(key) === '1'
  const isBlocked = () => exiting || isSignedOut()
  const clearCredentials = () => {
    browser.localStorage.removeItem(keys.token)
    browser.sessionStorage.removeItem(keys.verify)
  }
  const show = () => {
    clearCredentials()
    // 固定公开路径：不保存、消费或传递旧 Fragment 与回跳地址。
    navigate('/signed-out')
  }
  return {
    isSignedOut,
    isBlocked,
    show,
    prepareReentry(callbackToken: string) {
      const token = callbackToken || browser.localStorage.getItem(keys.token)
      if (!token || exiting) return undefined
      // 回跳可能先保存凭据再导航到业务深链；恢复必须向中心重新校验，不用缓存。
      browser.sessionStorage.removeItem(keys.verify)
      return () => {
        // 退出会清除 Token；迟到的校验结果不能撤销这次退出。
        if (exiting || browser.localStorage.getItem(keys.token) !== token) return false
        browser.localStorage.removeItem(key)
        return true
      }
    },
    assertActive() {
      if (isBlocked()) throw new SignedOutError()
    },
    begin() {
      exiting = true
    },
    failed() {
      exiting = false
    },
    complete(ssoWebUrl?: string) {
      browser.localStorage.setItem(key, '1')
      exiting = false
      if (ssoWebUrl) {
        clearCredentials()
        navigate(new URL('/logout?local_only=1', ssoWebUrl).href)
      } else show()
    },
    reenter() {
      clearCredentials()
      browser.localStorage.removeItem(key)
      navigate('/')
    },
    listen(onExit: () => void) {
      const check = () => {
        if (isSignedOut()) {
          onExit()
          show()
        }
      }
      const storage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) check()
      }
      browser.addEventListener('storage', storage)
      browser.addEventListener('pageshow', check)
      return () => {
        browser.removeEventListener('storage', storage)
        browser.removeEventListener('pageshow', check)
      }
    },
  }
}

export type SignOut = ReturnType<typeof createSignOut>
