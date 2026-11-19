(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JxSsoGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var JX_SSO_GUARD_VERSION = '2.2.0';
  var VERIFY_CACHE_TTL_MS = 60 * 1000;
  var DIAGNOSTICS_ID = 'jx-sso-guard-diagnostics';
  var activeContext = null;

  function normalizeRootUrl(value, fieldName) {
    var url;
    try {
      url = new URL(value);
    } catch (_error) {
      throw new Error(fieldName + ' 必须是完整的 HTTP/HTTPS 地址');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(fieldName + ' 只允许 HTTP/HTTPS');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(fieldName + ' 不能包含账号、参数或 Fragment');
    }
    return url.href.replace(/\/+$/, '');
  }

  function getSsoStorageKey(appId, ssoApiUrl) {
    var normalizedAppId = String(appId || '').trim();
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(normalizedAppId)) {
      throw new Error('appId 格式错误');
    }
    return 'jx_sso_token:' + encodeURIComponent(normalizeRootUrl(ssoApiUrl, 'ssoApiUrl')) + ':' + normalizedAppId;
  }

  function normalizeEnvironment(value) {
    if (typeof value === 'undefined') return '';
    if (value !== 'local' && value !== 'test' && value !== 'prod') {
      throw new Error('environment 仅允许 local、test 或 prod');
    }
    return value;
  }

  function buildLoginUrl(ssoWebUrl, appId, redirectUrl) {
    var loginUrl = new URL('/login', normalizeRootUrl(ssoWebUrl, 'ssoWebUrl'));
    loginUrl.searchParams.set('app_id', appId);
    loginUrl.searchParams.set('redirect_url', redirectUrl);
    return loginUrl.toString();
  }

  function buildNoPermissionUrl(ssoWebUrl, appId, redirectUrl) {
    var noPermissionUrl = new URL(
      '/no-permission',
      normalizeRootUrl(ssoWebUrl, 'ssoWebUrl')
    );
    noPermissionUrl.searchParams.set('app_id', appId);
    if (redirectUrl) {
      noPermissionUrl.searchParams.set('redirect_url', sanitizeCurrentUrl(redirectUrl, ssoWebUrl));
    }
    return noPermissionUrl.toString();
  }

  function sanitizeCurrentUrl(value, origin) {
    var current = new URL(value, origin);
    current.searchParams.delete('token');
    var fragment = current.hash.replace(/^#/, '');
    if (
      new URLSearchParams(fragment).has('token') ||
      new URLSearchParams(fragment.replace(/^[^?]*\?/, '')).has('token')
    ) current.hash = '';
    return current.toString();
  }

  function getSafeCurrentUrl(locationObject) {
    return sanitizeCurrentUrl(locationObject.href, locationObject.origin);
  }

  function readTokenCallback(locationObject) {
    var fragment = new URLSearchParams(locationObject.hash.replace(/^#/, ''));
    return {
      token: fragment.get('token') || '',
      redirect: fragment.get('redirect') || ''
    };
  }

  function replaceWithSafeCallbackTarget(locationObject, historyObject, redirect) {
    if (redirect) {
      var target = new URL(sanitizeCurrentUrl(redirect, locationObject.origin));
      if (target.origin !== locationObject.origin) {
        throw new Error('SSO 回调目标必须与子应用同源');
      }
      if (target.pathname === locationObject.pathname && target.search === locationObject.search) {
        historyObject.replaceState(null, '', target.pathname + target.search + target.hash);
        return false;
      }
      locationObject.replace(target.toString());
      return true;
    }
    historyObject.replaceState(
      null,
      '',
      locationObject.pathname + locationObject.search
    );
    return false;
  }

  function readVerificationCache(storage, cacheKey, token, ssoApiUrl) {
    var cached;
    try {
      cached = JSON.parse(storage.getItem(cacheKey) || 'null');
      if (
        !cached ||
        typeof cached.verifiedAt !== 'number' ||
        cached.verifiedAt > Date.now() ||
        Date.now() - cached.verifiedAt >= VERIFY_CACHE_TTL_MS ||
        cached.token !== token ||
        cached.ssoApiUrl !== ssoApiUrl ||
        !cached.data ||
        cached.data.application_allowed !== true
      ) {
        storage.removeItem(cacheKey);
        return null;
      }
      return cached.data;
    } catch (_error) {
      try {
        storage.removeItem(cacheKey);
      } catch (_removeError) {
        // 缓存不可用不应阻止实时校验。
      }
      return null;
    }
  }

  function writeVerificationCache(storage, cacheKey, token, ssoApiUrl, data) {
    try {
      storage.setItem(cacheKey, JSON.stringify({
        verifiedAt: Date.now(),
        token: token,
        ssoApiUrl: ssoApiUrl,
        data: data
      }));
    } catch (_error) {
      // sessionStorage 是性能优化；写入失败时仍以实时校验结果为准。
    }
  }

  function clearVerificationCache(storage, cacheKey) {
    try {
      storage.removeItem(cacheKey);
    } catch (_error) {
      // 401 跳转仍需继续，不能被缓存清理异常打断。
    }
  }

  function getRequestId(response) {
    if (!response || !response.headers || !response.headers.get) return '未知';
    return response.headers.get('X-Request-Id') || '未知';
  }

  function addDiagnosticRow(documentObject, list, label, value) {
    var row = documentObject.createElement('div');
    var term = documentObject.createElement('dt');
    var description = documentObject.createElement('dd');
    row.style.cssText = 'display:grid;grid-template-columns:8rem 1fr;gap:0.75rem;';
    term.style.cssText = 'font-weight:600;color:#334155;';
    description.style.cssText = 'margin:0;overflow-wrap:anywhere;color:#0f172a;';
    term.textContent = label;
    description.textContent = String(value);
    row.appendChild(term);
    row.appendChild(description);
    list.appendChild(row);
  }

  function renderDiagnostics(context, response, body) {
    var documentObject = context.browser.document;
    var mountTarget = documentObject.body || documentObject.documentElement;
    if (!mountTarget || !documentObject.createElement) return;

    var existing = documentObject.getElementById
      ? documentObject.getElementById(DIAGNOSTICS_ID)
      : null;
    if (existing && existing.remove) existing.remove();

    var panel = documentObject.createElement('section');
    var title = documentObject.createElement('h2');
    var summary = documentObject.createElement('p');
    var details = documentObject.createElement('dl');
    var nextStep = documentObject.createElement('p');
    var businessCode = body && Object.prototype.hasOwnProperty.call(body, 'code')
      ? body.code
      : '未知';
    var httpStatus = response && typeof response.status !== 'undefined'
      ? response.status
      : '不可用';

    panel.id = DIAGNOSTICS_ID;
    panel.setAttribute('role', 'alert');
    panel.setAttribute('aria-live', 'assertive');
    panel.setAttribute('aria-labelledby', DIAGNOSTICS_ID + '-title');
    panel.style.cssText = [
      'box-sizing:border-box',
      'max-width:48rem',
      'margin:2rem auto',
      'padding:1.5rem',
      'border:1px solid #b91c1c',
      'border-radius:0.5rem',
      'background:#fff7ed',
      'color:#0f172a',
      'font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');

    title.id = DIAGNOSTICS_ID + '-title';
    title.style.cssText = 'margin:0 0 0.5rem;font-size:1.25rem;line-height:1.4;';
    title.textContent = 'SSO 登录校验失败';
    summary.style.cssText = 'margin:0 0 1rem;';
    summary.textContent = '应用暂时无法确认你的登录状态。';
    details.style.cssText = 'display:grid;gap:0.5rem;margin:0;';
    nextStep.style.cssText = 'margin:1rem 0 0;font-weight:600;';
    nextStep.textContent = '请把本页截图发给 SSO 管理员。';

    addDiagnosticRow(documentObject, details, '应用编码', context.appId);
    addDiagnosticRow(
      documentObject,
      details,
      '环境编码',
      context.environment || '未配置'
    );
    addDiagnosticRow(documentObject, details, 'SSO Web 地址', context.ssoWebUrl);
    addDiagnosticRow(documentObject, details, 'SSO API 地址', context.ssoApiUrl);
    addDiagnosticRow(documentObject, details, 'HTTP 状态', httpStatus);
    addDiagnosticRow(documentObject, details, '业务 code', businessCode);
    addDiagnosticRow(documentObject, details, '请求追踪号', getRequestId(response));
    addDiagnosticRow(
      documentObject,
      details,
      '守卫版本',
      JX_SSO_GUARD_VERSION
    );

    panel.appendChild(title);
    panel.appendChild(summary);
    panel.appendChild(details);
    panel.appendChild(nextStep);
    mountTarget.appendChild(panel);
  }

  function clearAuthentication(context) {
    try {
      context.browser.localStorage.removeItem(context.storageKey);
    } finally {
      clearVerificationCache(context.browser.sessionStorage, context.cacheKey);
    }
  }

  function redirectToLogin(context) {
    if (!context.redirectStarted) {
      context.redirectStarted = true;
      context.browser.location.replace(context.loginUrl);
    }
  }

  function onUnauthorized(response) {
    if (!activeContext) {
      throw new Error('onUnauthorized 使用前必须先调用 guardApplicationAccess');
    }
    if (!response || response.status !== 401) return false;
    clearAuthentication(activeContext);
    redirectToLogin(activeContext);
    return true;
  }

  async function guardApplicationAccess(options) {
    options = options || {};
    var appId = String(options.appId || '').trim();
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(appId)) {
      throw new Error('appId 格式错误');
    }

    var environment = normalizeEnvironment(options.environment);
    var browser = options.browser || (typeof window !== 'undefined' ? window : null);
    if (
      !browser ||
      !browser.location ||
      !browser.history ||
      !browser.localStorage ||
      !browser.sessionStorage ||
      !browser.document ||
      !browser.fetch
    ) {
      throw new Error('guardApplicationAccess 只能在浏览器环境运行');
    }

    var ssoWebUrl = normalizeRootUrl(options.ssoWebUrl, 'ssoWebUrl');
    var ssoApiUrl = normalizeRootUrl(options.ssoApiUrl, 'ssoApiUrl');
    var defaultStorageKey = getSsoStorageKey(appId, ssoApiUrl);
    var storageKey = options.storageKey || defaultStorageKey;
    var cacheKey = defaultStorageKey.replace('jx_sso_token:', 'jx_sso_verify:');
    var currentUrl = options.currentUrl
      ? sanitizeCurrentUrl(options.currentUrl, browser.location.origin)
      : getSafeCurrentUrl(browser.location);
    var loginUrl = buildLoginUrl(ssoWebUrl, appId, currentUrl);
    var callback = readTokenCallback(browser.location);

    var context = {
      appId: appId,
      browser: browser,
      cacheKey: cacheKey,
      environment: environment,
      loginUrl: loginUrl,
      redirectStarted: false,
      ssoApiUrl: ssoApiUrl,
      ssoWebUrl: ssoWebUrl,
      storageKey: storageKey
    };
    activeContext = context;

    if (callback.token) {
      browser.localStorage.setItem(storageKey, callback.token);
      clearVerificationCache(browser.sessionStorage, cacheKey);
      if (
        replaceWithSafeCallbackTarget(
          browser.location,
          browser.history,
          callback.redirect
        )
      ) {
        return { status: 'redirecting' };
      }
      if (callback.redirect && !options.currentUrl) {
        currentUrl = sanitizeCurrentUrl(callback.redirect, browser.location.origin);
        context.loginUrl = buildLoginUrl(ssoWebUrl, appId, currentUrl);
      }
    }

    var token = browser.localStorage.getItem(storageKey) || '';
    if (!token) {
      redirectToLogin(context);
      return { status: 'redirecting' };
    }

    var cachedData = readVerificationCache(
      browser.sessionStorage,
      cacheKey,
      token,
      ssoApiUrl
    );
    if (cachedData) {
      return { status: 'allowed', data: cachedData, cached: true };
    }

    var response;
    var body;
    try {
      response = await browser.fetch(
        ssoApiUrl + '/auth/verify?app_id=' + encodeURIComponent(appId),
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + token,
            'X-Jx-Sso-Guard': JX_SSO_GUARD_VERSION
          },
          credentials: 'omit',
          cache: 'no-store'
        }
      );
    } catch (error) {
      renderDiagnostics(context, null, null);
      if (typeof options.onUnavailable === 'function') options.onUnavailable(error);
      throw new Error('SSO 权限校验服务暂时不可用');
    }

    try {
      body = await response.json();
    } catch (error) {
      renderDiagnostics(context, response, null);
      if (typeof options.onUnavailable === 'function') options.onUnavailable(error);
      throw new Error('SSO 权限校验响应无效');
    }

    var code = String(body && body.code);
    if (response.status === 401 || code === '401') {
      renderDiagnostics(context, response, body);
      clearAuthentication(context);
      redirectToLogin(context);
      return { status: 'redirecting' };
    }
    if (response.status === 403 || code === '403') {
      renderDiagnostics(context, response, body);
      browser.location.replace(buildNoPermissionUrl(ssoWebUrl, appId, currentUrl));
      return { status: 'forbidden' };
    }
    if (
      !response.ok ||
      code !== '0' ||
      !body ||
      !body.data ||
      body.data.application_allowed !== true
    ) {
      var contractError = new Error('SSO 权限校验响应无效');
      renderDiagnostics(context, response, body);
      if (typeof options.onUnavailable === 'function') {
        options.onUnavailable(contractError);
      }
      throw contractError;
    }

    writeVerificationCache(
      browser.sessionStorage,
      cacheKey,
      token,
      ssoApiUrl,
      body.data
    );
    return { status: 'allowed', data: body.data };
  }

  return {
    JX_SSO_GUARD_VERSION: JX_SSO_GUARD_VERSION,
    getSsoStorageKey: getSsoStorageKey,
    guardApplicationAccess: guardApplicationAccess,
    onUnauthorized: onUnauthorized,
    buildLoginUrl: buildLoginUrl,
    buildNoPermissionUrl: buildNoPermissionUrl,
    readTokenCallback: readTokenCallback
  };
});
