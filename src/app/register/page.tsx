'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { UserPlus, X } from 'lucide-react';

const ROLES = [
  { value: 'UPLOADER', label: '上传者 — 上传图片、查看自己的图片和仪表盘' },
  { value: 'REVIEWER', label: '审核员 — 审核图片、归档管理、上传图片' },
  { value: 'ADMIN', label: '管理员 — 全部权限，含用户管理' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [form, setForm] = useState({
    name: '',
    department: '',
    email: '',
    password: '',
    role: 'UPLOADER',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // 仅管理员或审核员可访问此页面
  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    const user = session?.user as any;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.role !== 'ADMIN' && user.role !== 'REVIEWER') {
      router.replace('/dashboard');
    }
  }, [session, status, router]);

  if (status === 'loading' || !session) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--color-bg)' }}>
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-accent)' }}
        />
      </div>
    );
  }

  const user = session?.user as any;
  if (user?.role !== 'ADMIN' && user?.role !== 'REVIEWER') {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) { setError('请输入真实姓名'); return; }
    if (!form.department.trim()) { setError('请输入直属部门'); return; }
    if (form.password.length < 6) { setError('密码至少 6 位'); return; }

    setShowConfirm(true);
  };

  const confirmRegister = async () => {
    setShowConfirm(false);
    setLoading(true);
    setError('');
    setSuccess('');

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error || '创建失败');
    } else {
      setSuccess(`用户「${form.name}」创建成功！`);
      setForm({ name: '', department: '', email: '', password: '', role: 'UPLOADER' });
    }
  };

  const inputClass =
    'w-full px-3.5 py-2.5 rounded-[var(--radius-input)] text-sm transition-shadow duration-150';

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: 'var(--color-bg)' }}>
      <main className="w-full" style={{ maxWidth: '440px' }}>
        <div className="text-center mb-8">
          <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--color-fg)' }}>
            创建用户账号
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--color-muted)' }}>
                        由管理员或审核员为新用户创建账号
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

          {success && (
            <div
              className="mb-5 px-4 py-2.5 rounded-[var(--radius-input)] text-sm"
              style={{ background: 'oklch(65% 0.18 165 / 0.08)', color: 'oklch(45% 0.15 165)' }}
            >
              {success}
            </div>
          )}

          {/* 姓名 */}
          <div className="mb-4">
            <label htmlFor="reg-name" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-fg)' }}>
              真实姓名（登录账号）
            </label>
            <input
              id="reg-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
              placeholder="请输入真实姓名"
              autoFocus
              required
            />
          </div>

          {/* 部门 */}
          <div className="mb-4">
            <label htmlFor="reg-dept" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-fg)' }}>
              直属部门
            </label>
            <input
              id="reg-dept"
              type="text"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className={inputClass}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
              placeholder="如：设计部、市场部、技术部"
              required
            />
          </div>

          {/* 邮箱 */}
          <div className="mb-4">
            <label htmlFor="reg-email" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-fg)' }}>
              邮箱（选填）
            </label>
            <input
              id="reg-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
              placeholder="请输入邮箱"
            />
          </div>

          {/* 密码 */}
          <div className="mb-4">
            <label htmlFor="reg-pw" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-fg)' }}>
              密码
            </label>
            <input
              id="reg-pw"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputClass}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
              placeholder="请输入密码（至少6位）"
              required
              minLength={6}
            />
          </div>

          {/* 角色 */}
          <div className="mb-6">
            <label htmlFor="reg-role" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-fg)' }}>
              角色
            </label>
            <select
              id="reg-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className={inputClass}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-fg)' }}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
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
          >
            <UserPlus className="w-4 h-4" />
            {loading ? '创建中…' : '创建用户'}
          </button>
        </form>
      </main>

      {/* 确认弹窗 */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div
            className="w-full p-6 rounded-[var(--radius-card)] shadow-xl animate-fade-in-up"
            style={{ maxWidth: '380px', background: 'var(--color-surface)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>
                确认创建用户
              </h3>
              <button
                onClick={() => setShowConfirm(false)}
                className="p-1 rounded-[var(--radius-input)] hover:bg-[var(--color-bg)] transition-colors"
              >
                <X className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
              </button>
            </div>
            <div className="space-y-2 text-sm mb-6" style={{ color: 'var(--color-fg)' }}>
              <p><span className="font-medium">姓名：</span>{form.name}</p>
              <p><span className="font-medium">部门：</span>{form.department}</p>
              {form.email && <p><span className="font-medium">邮箱：</span>{form.email}</p>}
              <p>
                <span className="font-medium">角色：</span>
                {ROLES.find((r) => r.value === form.role)?.label.split(' — ')[0]}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmRegister}
                className="flex-1 py-2.5 rounded-[var(--radius-input)] text-sm font-semibold transition-all duration-150"
                style={{ background: 'oklch(58% 0.18 255)', color: 'white' }}
              >
                确认创建
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 rounded-[var(--radius-input)] text-sm font-medium transition-colors"
                style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}
              >
                返回修改
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
