'use client';

import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Upload,
  CheckCircle,
  Archive,
  Users,
  LogOut,
  Menu,
  X,
  BarChart3,
  Bell,
} from 'lucide-react';
import { useState, useEffect } from 'react';

const mainNav = [
  { href: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { href: '/upload', label: '上传图片', icon: Upload },
  { href: '/review', label: '审核中心', icon: CheckCircle, badgeKey: 'pendingCount' },
  { href: '/data-center', label: '数据中心', icon: BarChart3 },
  { href: '/archive', label: '归档管理', icon: Archive },
];

const systemNav = [
  { href: '/admin/users', label: '用户管理', icon: Users, role: 'ADMIN' },
];

export default function AppLayout({ children, title }: { children: React.ReactNode; title?: string }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const userRole = (session?.user as any)?.role || 'UPLOADER';
  const userName = session?.user?.name || '';
  const isReviewer = userRole === 'REVIEWER';

  // 仅凭姓名的最后一个字做头像回退（如"何扬帆" → "帆"）
  const avatarText = userName ? userName[userName.length - 1] : '?';

  // 获取待审核数 + 未读通知数
  useEffect(() => {
    fetch('/api/stats')
      .then((r) => r.json())
      .then((d) => setPendingCount(d.pendingCount || 0))
      .catch(() => {});
    fetch('/api/notifications?unread=true&limit=1')
      .then((r) => r.json())
      .then((d) => setUnreadCount(d.unreadCount || 0))
      .catch(() => {});
  }, []);

  const isActive = (href: string) => pathname.startsWith(href);

  const sidebarContent = (
    <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
      <div className="px-3 py-1.5 mb-1">
        <span className="text-[11px] font-medium tracking-wider uppercase" style={{ color: 'var(--color-muted)' }}>
          主菜单
        </span>
      </div>
      {mainNav.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between px-3 py-2.5 rounded-[var(--radius-nav)] text-sm font-medium transition-[background,color] duration-150 ${
              active
                ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]'
            }`}
            style={{ letterSpacing: '-0.01em' }}
          >
            <span className="flex items-center gap-3">
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              {item.label}
            </span>
            {item.badgeKey && pendingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-semibold rounded-[var(--radius-pill)] bg-[var(--color-warn-subtle)] text-[var(--color-warn)]">
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}

      {systemNav.filter((i) => !i.role || i.role === userRole || (i.role === 'ADMIN' && isReviewer)).length > 0 && (
        <>
          <div className="px-3 pt-5 pb-1.5">
            <span className="text-[11px] font-medium tracking-wider uppercase" style={{ color: 'var(--color-muted)' }}>
              系统
            </span>
          </div>
          {systemNav
            .filter((i) => !i.role || i.role === userRole || (i.role === 'ADMIN' && isReviewer))
            .map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-nav)] text-sm font-medium transition-[background,color] duration-150 ${
                    active
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                      : 'text-[var(--color-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]'
                  }`}
                >
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                  {item.label}
                </Link>
              );
            })}
        </>
      )}

      <div className="px-3 pt-5">
        <button
                    onClick={() => signOut({ callbackUrl: '/login?logout=1' })}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-[var(--radius-nav)] text-sm font-medium transition-[background,color] duration-150"
          style={{ color: 'var(--color-muted)' }}
          onMouseEnter={(e) => {
            (e.target as HTMLButtonElement).style.background = 'var(--color-danger-subtle)';
            (e.target as HTMLButtonElement).style.color = 'var(--color-danger)';
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLButtonElement).style.background = '';
            (e.target as HTMLButtonElement).style.color = 'var(--color-muted)';
          }}
        >
          <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
          退出登录
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar — 232px fixed */}
      <aside
        className="hidden md:flex md:flex-col md:w-[232px] md:flex-shrink-0 h-full border-r"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {/* Logo */}
        <div className="flex items-center h-14 px-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span
            className="text-base font-semibold tracking-tight"
            style={{ color: 'var(--color-fg)', letterSpacing: '-0.02em' }}
          >
            AI 图片审核
          </span>
        </div>
        {sidebarContent}
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between h-14 px-4">
          <span className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>AI 图片审核</span>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-[var(--radius-input)]"
            style={{ color: 'var(--color-muted)' }}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {mobileOpen && (
          <div className="border-t" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            {sidebarContent}
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col md:ml-0 overflow-hidden">
        {/* Topbar */}
        <header
          className="flex items-center justify-between h-14 px-10 flex-shrink-0 border-b mt-14 md:mt-0"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <h1
            className="text-2xl font-semibold"
            style={{ color: 'var(--color-fg)', letterSpacing: '-0.02em' }}
          >
            {title || '仪表盘'}
          </h1>
          <div
            className="flex items-center gap-3"
          >
            {/* 通知铃铛 */}
            <Link href="/notifications" className="relative p-2 rounded-lg transition-colors hover:bg-[var(--color-bg)]">
              <Bell className="w-5 h-5" style={{ color: 'var(--color-muted)' }} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-[var(--color-danger)] text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            {/* 用户 */}
            <div
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--radius-pill)] cursor-default select-none"
              style={{ background: 'var(--color-bg)' }}
            >
              <div
                className="w-7 h-7 rounded-[var(--radius-pill)] flex items-center justify-center text-xs font-semibold"
                style={{ background: 'var(--color-accent)', color: 'white' }}
              >
                {avatarText}
              </div>
              <span className="text-sm font-medium" style={{ color: 'var(--color-fg)' }}>
                {userName}
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto" style={{ padding: '32px 40px' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
