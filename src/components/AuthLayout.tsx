'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useSsoApp } from '@/components/sso/SsoAppGate';

export default function AuthLayout({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { phase, user } = useSsoApp();
  const router = useRouter();

  useEffect(() => {
    // 准备阶段未登录回原登录页；SSO 模式由启动门卫保证身份
    if (phase === 'legacy' && !user) {
      router.push('/login');
    }
  }, [phase, user, router]);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--color-bg)' }}>
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-accent)' }}
        />
      </div>
    );
  }

  return <AppLayout title={title}>{children}</AppLayout>;
}
