'use client';

import { useEffect, useState } from 'react';
import AuthLayout from '@/components/AuthLayout';
import { Bell, CheckCheck, Package, Image as ImageIcon, XCircle } from 'lucide-react';

interface Notification {
  id: string;
  type: string;
  message: string;
  relatedId: string | null;
  read: boolean;
  createdAt: string;
}

const typeIcon: Record<string, any> = {
  SPU_APPROVED: CheckCheck,
  SPU_REJECTED: XCircle,
  IMAGE_REJECTED: XCircle,
};

const typeColor: Record<string, { bg: string; fg: string }> = {
  SPU_APPROVED:  { bg: 'oklch(66% 0.16 160 / 0.08)', fg: 'oklch(45% 0.15 155)' },
  SPU_REJECTED:  { bg: 'oklch(56% 0.18 25 / 0.06)',  fg: 'oklch(45% 0.16 25)' },
  IMAGE_REJECTED: { bg: 'oklch(70% 0.15 80 / 0.08)', fg: 'oklch(50% 0.14 75)' },
};

const C = {
  accent: 'oklch(58% 0.18 255)',
  fg:     'oklch(18% 0.012 250)',
  muted:  'oklch(54% 0.012 250)',
  border: 'oklch(92% 0.005 250)',
  surface:'oklch(100% 0 0)',
  bg:     'oklch(99% 0.002 240)',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=50');
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => { fetchNotifications(); }, []);

  const markAllRead = async () => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markRead = async (id: string) => {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AuthLayout title="消息通知">
      {unreadCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm" style={{ color: C.muted }}>
            {unreadCount} 条未读
          </span>
          <button
            onClick={markAllRead}
            className="text-[13px] font-medium px-3 py-1.5 rounded-full transition-all"
            style={{ color: C.accent, background: 'oklch(58% 0.18 255 / 0.06)' }}
          >
            全部标为已读
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse"
              style={{ background: C.surface, border: `1px solid ${C.border}` }}
            >
              <div className="h-4 w-3/4 rounded" style={{ background: C.bg }} />
              <div className="h-3 w-1/3 rounded mt-2" style={{ background: C.bg }} />
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div
          className="text-center py-20 rounded-xl"
          style={{ background: C.surface, border: `1px solid ${C.border}` }}
        >
          <Bell className="w-8 h-8 mx-auto mb-3" style={{ color: C.muted, opacity: 0.4 }} />
          <p style={{ color: C.muted }}>暂无通知</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = typeIcon[n.type] || Bell;
            const colors = typeColor[n.type] || { bg: C.bg, fg: C.muted };
            return (
              <div
                key={n.id}
                className="rounded-xl p-4 flex items-start gap-3 transition-all cursor-pointer"
                style={{
                  background: n.read ? C.surface : 'oklch(58% 0.18 255 / 0.03)',
                  border: `1px solid ${n.read ? C.border : 'oklch(58% 0.18 255 / 0.15)'}`,
                }}
                onClick={() => !n.read && markRead(n.id)}
              >
                <div
                  className="p-2 rounded-full flex-shrink-0"
                  style={{ background: colors.bg }}
                >
                  <Icon className="w-4 h-4" style={{ color: colors.fg }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: C.fg, fontWeight: n.read ? 400 : 600 }}
                  >
                    {n.message}
                  </p>
                  <p className="text-xs mt-1" style={{ color: C.muted }}>
                    {formatTime(n.createdAt)}
                  </p>
                </div>
                {!n.read && (
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0 mt-2"
                    style={{ background: 'var(--color-accent, oklch(58% 0.18 255))' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </AuthLayout>
  );
}
