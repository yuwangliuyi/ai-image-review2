export as namespace JxSsoGuard;

export const JX_SSO_GUARD_VERSION: '2.2.0';

/** Token key scoped to the normalized SSO API and application. Old unscoped tokens are not migrated. */
export function getSsoStorageKey(appId: string, ssoApiUrl: string): string;

export type GuardEnvironment = 'local' | 'test' | 'prod';

export interface VerifyData {
  application_allowed: true;
  user_id?: number;
  username?: string;
  name?: string;
  [key: string]: unknown;
}

export interface GuardOptions {
  appId: string;
  ssoWebUrl: string;
  ssoApiUrl: string;
  environment?: GuardEnvironment;
  currentUrl?: string;
  storageKey?: string;
  onUnavailable?: (error: Error) => void;
  browser?: Window;
}

export interface GuardAllowedResult {
  status: 'allowed';
  data: VerifyData;
  cached?: true;
}

export interface GuardRedirectingResult {
  status: 'redirecting';
}

export interface GuardForbiddenResult {
  status: 'forbidden';
}

export type GuardResult =
  | GuardAllowedResult
  | GuardRedirectingResult
  | GuardForbiddenResult;

export function guardApplicationAccess(
  options: GuardOptions
): Promise<GuardResult>;

export function onUnauthorized(
  response: Pick<Response, 'status'>
): boolean;

export function buildLoginUrl(
  ssoWebUrl: string,
  appId: string,
  redirectUrl: string
): string;

export function buildNoPermissionUrl(
  ssoWebUrl: string,
  appId: string,
  redirectUrl?: string
): string;

export function readTokenCallback(
  locationObject: Pick<Location, 'hash'>
): { token: string; redirect: string };
