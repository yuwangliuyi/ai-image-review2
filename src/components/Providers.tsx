'use client';

import { SessionProvider } from 'next-auth/react';
import SsoAppGate from '@/components/sso/SsoAppGate';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SsoAppGate>{children}</SsoAppGate>
    </SessionProvider>
  );
}
