/** Same public key contract as official guard 2.2.0; verified against vendored guard in tests. */
export function getSsoStorageKey(appId: string, ssoApiUrl: string): string {
  const id = appId.trim()
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(id)) throw new Error('应用 ID 不合法')
  const url = new URL(ssoApiUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SSO API 地址不合法')
  }
  return `jx_sso_token:${encodeURIComponent(url.href.replace(/\/+$/, ''))}:${id}`
}
export function ssoStorageKeys(appId: string, apiUrl: string) {
  const token = getSsoStorageKey(appId, apiUrl)
  return { token, verify: token.replace('jx_sso_token:', 'jx_sso_verify:'), signedOut: token.replace('jx_sso_token:', 'jx_sso_signed_out:') }
}
