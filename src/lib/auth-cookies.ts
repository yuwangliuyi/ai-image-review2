/** 同主机不同端口共享 Cookie；并行实例必须使用独立名称。 */
export function authCookies(env: { AUTH_COOKIE_PREFIX?: string; NEXTAUTH_URL?: string } = process.env) {
  const prefix = env.AUTH_COOKIE_PREFIX || 'next-auth';
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(prefix)) {
    throw new Error('AUTH_COOKIE_PREFIX 不合法');
  }
  const secure = env.NEXTAUTH_URL?.startsWith('https://') === true;
  const options = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure };
  const name = (suffix: string) => `${secure ? '__Secure-' : ''}${prefix}.${suffix}`;
  return {
    sessionToken: { name: name('session-token'), options },
    callbackUrl: { name: name('callback-url'), options },
    csrfToken: { name: `${secure ? '__Host-' : ''}${prefix}.csrf-token`, options },
    pkceCodeVerifier: { name: name('pkce.code_verifier'), options: { ...options, maxAge: 900 } },
    state: { name: name('state'), options: { ...options, maxAge: 900 } },
    nonce: { name: name('nonce'), options },
  };
}

export function ownedCookieNames(requestNames: string[], env: Parameters<typeof authCookies>[0] = process.env) {
  const cookies = authCookies(env);
  const names = Object.values(cookies).map(cookie => cookie.name);
  const session = cookies.sessionToken.name;
  return [...names, ...requestNames.filter(name =>
    name.startsWith(`${session}.`) && /^\d+$/.test(name.slice(session.length + 1)))];
}
