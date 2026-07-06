'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);

  // 已登录用户直接跳到仪表盘（但从退出登录跳转过来时跳过）
  useEffect(() => {
    if (status === 'authenticated') {
      const isLogout = new URLSearchParams(window.location.search).get('logout') === '1';
      if (!isLogout) {
        router.push('/dashboard');
      }
    }
  }, [status, router]);

  // 加载中不渲染登录表单
  if (status === 'loading' || status === 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg)' }}>
        <div className="text-sm" style={{ color: 'var(--color-muted)' }}>加载中…</div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入姓名');
      return;
    }

    setLoading(true);
    setToast(`正在登录 ${name.trim()} …`);

    const result = await signIn('credentials', {
      name: name.trim(),
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setToast('');
      setError(result.error);
    } else if (result?.ok) {
      router.push('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--color-bg)' }}>
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-[var(--radius-input)] text-sm font-medium shadow-lg animate-fade-in-up"
          style={{ background: 'var(--color-fg)', color: 'white' }}
        >
          {toast}
        </div>
      )}

      <main className="w-full" style={{ maxWidth: '420px' }}>
        <div className="text-center mb-10">
          <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            AI 图片审核系统
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            登录以继续
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-8 rounded-[var(--radius-form)] shadow-sm"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          {error && (
            <div
              className="mb-5 px-4 py-2.5 rounded-[var(--radius-input)] text-sm"
              style={{ background: 'var(--color-danger-subtle)', color: 'var(--color-danger)' }}
            >
              {error}
            </div>
          )}

          <div className="mb-4">
            <label
              htmlFor="login-name"
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--color-fg)' }}
            >
              姓名（登录账号）
            </label>
            <input
              id="login-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] text-sm transition-shadow duration-150"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-fg)',
              }}
              placeholder="请输入真实姓名"
              autoFocus
              required
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="login-password"
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--color-fg)' }}
            >
              密码
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-[var(--radius-input)] text-sm transition-shadow duration-150"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-fg)',
              }}
              placeholder="请输入密码"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-[var(--radius-input)] text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2"
            style={{
              background: 'oklch(58% 0.18 255)',
              color: 'white',
              opacity: loading ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!loading) (e.target as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.transform = '';
            }}
            onMouseDown={(e) => {
              if (!loading) (e.target as HTMLButtonElement).style.transform = 'scale(0.96)';
            }}
            onMouseUp={(e) => {
              (e.target as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
          >
            <LogIn className="w-4 h-4" />
            {loading ? '登录中…' : '登录'}
          </button>
        </form>
      </main>
    </div>
  );
}
