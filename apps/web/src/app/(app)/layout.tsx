'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, Suspense } from 'react';
import { useStore } from '@/store';

function NavContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, user, spaceName, clearAuth } = useStore();

  const spaceId = searchParams.get('space');

  useEffect(() => {
    if (!token || !user) {
      router.push('/');
    }
  }, [token, user, router]);

  const tabs = [
    { name: 'Meetings', href: `/meetings?space=${spaceId}` },
    { name: 'Chat', href: `/chat?space=${spaceId}` },
    { name: 'Activity', href: `/activity?space=${spaceId}` },
  ];

  const handleLogout = () => {
    clearAuth();
    router.push('/');
  };

  if (!token || !user) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-[var(--card)] border-b border-[var(--border)] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold">{spaceName || 'Loading...'}</h1>
            <nav className="flex gap-1">
              {tabs.map((tab) => {
                const isActive = pathname === tab.href.split('?')[0];
                return (
                  <button
                    key={tab.name}
                    onClick={() => router.push(tab.href)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[var(--primary)] text-white'
                        : 'text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]'
                    }`}
                  >
                    {tab.name}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--muted)]">{user.display_name}</span>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg text-sm text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)] transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <NavContent>{children}</NavContent>
    </Suspense>
  );
}
