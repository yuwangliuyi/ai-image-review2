'use client';

import { useEffect, useState } from 'react';
import { createSignOut } from '@/lib/sso/frontend/sign-out';
import { assertMode } from '@/lib/sso/frontend/startup';

/**
 * 公开停留页：早于模式查询、守卫和业务 UI 呈现；不消费 Fragment。
 * “重新进入”清退出标记并从正常入口启动官方守卫。
 */
export default function SignedOutPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', '/signed-out');
    }
  }, []);

  const reenter = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/mode', { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error('mode unavailable');
      const mode = await response.json();
      assertMode(mode);
      createSignOut(mode.app_id, window, mode.sso_api_url).reenter();
    } catch {
      setError('暂时无法连接应用，请稍后点击“重新进入”重试。');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-bg)' }}>
      <main className="w-full" style={{ maxWidth: '420px' }}>
        <div className="p-8 rounded-xl text-center" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <span
            className="inline-block px-3 py-1 mb-4 rounded-full text-xs font-medium"
            style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
          >
            当前应用已退出
          </span>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-fg)' }}>
            已退出当前应用
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            本页不会自动重新登录。需要继续使用本应用时，请点击“重新进入”。
          </p>
          {error && (
            <p className="mt-3 text-sm" style={{ color: 'var(--color-danger)' }} role="alert">
              {error}
            </p>
          )}
          <button
            onClick={reenter}
            disabled={busy}
            className="mt-6 w-full py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'oklch(58% 0.18 255)', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? '正在连接…' : '重新进入'}
          </button>
        </div>
      </main>
    </div>
  );
}
