import * as guardModule from './jx-sso-guard.js';

const guard = guardModule.default || globalThis.JxSsoGuard;

export const JX_SSO_GUARD_VERSION = guard.JX_SSO_GUARD_VERSION;
export const getSsoStorageKey = guard.getSsoStorageKey;
export const guardApplicationAccess = guard.guardApplicationAccess;
export const onUnauthorized = guard.onUnauthorized;
export const buildLoginUrl = guard.buildLoginUrl;
export const buildNoPermissionUrl = guard.buildNoPermissionUrl;
export const readTokenCallback = guard.readTokenCallback;
