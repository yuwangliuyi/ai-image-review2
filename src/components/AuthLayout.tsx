'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import AppLayout from '@/components/AppLayout';

export default function AuthLayout({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--color-bg)' }}>
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-accent)' }}
        />
      </div>
    );
  }

  if (!session) return null;

  return <AppLayout title={title}>{children}</AppLayout>;
}
