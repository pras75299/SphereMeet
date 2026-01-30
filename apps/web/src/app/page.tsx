'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';

export default function HomePage() {
  const router = useRouter();
  
  // Use individual selectors to prevent re-renders
  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const setAuth = useStore((state) => state.setAuth);
  const isHydrated = useStore((state) => state.isHydrated);
  const hydrate = useStore((state) => state.hydrate);

  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [seedingSpace, setSeedingSpace] = useState(false);

  // Hydrate store from localStorage on mount
  useEffect(() => {
    if (!isHydrated) {
      hydrate();
    }
  }, [isHydrated, hydrate]);

  const fetchSpaces = useCallback(async () => {
    const currentToken = useStore.getState().token;
    if (!currentToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/spaces`, {
        headers: {
          'Authorization': `Bearer ${currentToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setSpaces(data);
      }
    } catch (err) {
      console.error('Error fetching spaces:', err);
    }
  }, []);

  useEffect(() => {
    if (token && user) {
      fetchSpaces();
    }
  }, [token, user, fetchSpaces]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName.trim() }),
      });

      if (!res.ok) {
        throw new Error('Failed to create guest account');
      }

      const data = await res.json();
      setAuth(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleSeedSpace = async () => {
    setSeedingSpace(true);
    try {
      const res = await fetch(`${API_BASE}/api/dev/seed`, { method: 'POST' });
      if (res.ok) {
        fetchSpaces();
      }
    } catch (err) {
      console.error('Error seeding space:', err);
    } finally {
      setSeedingSpace(false);
    }
  };

  const handleJoinSpace = (spaceId: string) => {
    router.push(`/activity?space=${spaceId}`);
  };

  // Show loading while hydrating to prevent SSR mismatch
  if (!isHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-[var(--muted)]">Loading...</div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-[var(--card)] rounded-2xl p-8 border border-[var(--border)]">
            <h1 className="text-3xl font-bold text-center mb-2">Gather Clone</h1>
            <p className="text-[var(--muted)] text-center mb-8">
              Virtual office with proximity audio/video
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="displayName" className="block text-sm font-medium mb-2">
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 rounded-lg bg-[var(--background)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)] transition-colors"
                  maxLength={50}
                />
              </div>

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium transition-colors disabled:opacity-50"
              >
                {loading ? 'Joining...' : 'Join as Guest'}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-[var(--card)] rounded-2xl p-8 border border-[var(--border)]">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold">Welcome, {user.display_name}!</h1>
              <p className="text-[var(--muted)]">Select a space to join</p>
            </div>
            <button
              onClick={handleSeedSpace}
              disabled={seedingSpace}
              className="px-4 py-2 rounded-lg bg-[var(--border)] hover:bg-[var(--card-hover)] text-sm transition-colors disabled:opacity-50"
            >
              {seedingSpace ? 'Creating...' : '+ Create Demo Space'}
            </button>
          </div>

          {spaces.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[var(--muted)] mb-4">No spaces available</p>
              <p className="text-sm text-[var(--muted)]">
                Click &quot;Create Demo Space&quot; to get started
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {spaces.map((space) => (
                <button
                  key={space.id}
                  onClick={() => handleJoinSpace(space.id)}
                  className="w-full p-4 rounded-lg bg-[var(--background)] hover:bg-[var(--card-hover)] border border-[var(--border)] text-left transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{space.name}</h3>
                      <p className="text-sm text-[var(--muted)]">Click to join</p>
                    </div>
                    <span className="text-[var(--primary)] group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
