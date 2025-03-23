'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, Suspense, useCallback } from 'react';
import { useStore } from '@/store';
import { WebSocketProvider } from '@/hooks/WebSocketProvider';

function NavContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Use individual selectors to prevent re-renders
  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const spaceName = useStore((state) => state.spaceName);
  const clearAuth = useStore((state) => state.clearAuth);
  const isHydrated = useStore((state) => state.isHydrated);
  const hydrate = useStore((state) => state.hydrate);

  const spaceId = searchParams.get('space');

  // Hydrate store from localStorage on mount
  useEffect(() => {
    if (!isHydrated) {
      hydrate();
    }
  }, [isHydrated, hydrate]);

  useEffect(() => {
    if (isHydrated) {
      if (!token || !user) {
        router.push('/');
      } else if (!spaceId && pathname !== '/') {
        router.push('/');
      }
    }
  }, [token, user, router, isHydrated, spaceId, pathname]);

  const tabs = [
    { name: 'Meetings', href: `/meetings?space=${spaceId}` },
    { name: 'Chat', href: `/chat?space=${spaceId}` },
    { name: 'Activity', href: `/activity?space=${spaceId}` },
  ];

  const handleLogout = useCallback(() => {
    clearAuth();
    router.push('/');
  }, [clearAuth, router]);

  // Show loading while hydrating or if not authenticated
  if (!isHydrated || !token || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <p className="pixel-mono text-[var(--secondary)] text-sm animate-pulse tracking-widest uppercase">
          BOOT_SEQUENCE...
        </p>
      </div>
    );
  }

  return (
    <WebSocketProvider spaceId={spaceId}>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--background)]">
        <header
          className="flex-shrink-0 px-4 py-2 flex items-center justify-between"
          style={{
            background: "var(--surface-mid)",
            borderBottom: "2px solid var(--outline-dim)",
          }}
        >
          <div className="flex items-center gap-6 max-w-7xl">
            <div className="flex items-center gap-2">
              <span className="pixel-badge-on" />
              <h1
                className="pixel-mono text-sm tracking-widest font-bold uppercase"
                style={{ color: "var(--secondary-lit)" }}
              >
                {spaceName || 'CONNECTING...'}
              </h1>
            </div>
            <nav className="flex gap-2">
              {tabs.map((tab) => {
                const isActive = pathname === tab.href.split('?')[0];
                return (
                  <button
                    key={tab.name}
                    onClick={() => router.push(tab.href)}
                    className="pixel-btn px-3 py-1.5 pixel-mono text-[10px] uppercase tracking-widest transition-all"
                    style={{
                      background: isActive ? "var(--primary)" : "var(--surface-lowest)",
                      color: isActive ? "#fff" : "var(--muted)",
                      borderBottom: isActive ? "2px solid #312e81" : "2px solid var(--surface-low)",
                      opacity: isActive ? 1 : 0.7,
                    }}
                  >
                    {tab.name}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="pixel-mono text-[10px] text-[var(--muted)] uppercase tracking-widest">
              OP: <span style={{ color: "var(--foreground)" }}>{user.display_name}</span>
            </span>
            <button
              onClick={handleLogout}
              className="pixel-btn px-3 py-1.5 pixel-mono text-[10px] uppercase tracking-widest"
              style={{
                background: "#7f1d1d",
                color: "#fca5a5",
                borderBottom: "2px solid #450a0a",
              }}
            >
              LOGOUT
            </button>
          </div>
        </header>
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </WebSocketProvider>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <NavContent>{children}</NavContent>
    </Suspense>
  );
}
