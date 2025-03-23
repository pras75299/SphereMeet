"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

export default function HomePage() {
  const router = useRouter();

  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const setAuth = useStore((state) => state.setAuth);
  const isHydrated = useStore((state) => state.isHydrated);
  const hydrate = useStore((state) => state.hydrate);

  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [seedingSpace, setSeedingSpace] = useState(false);
  const [seedBanner, setSeedBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!isHydrated) hydrate();
  }, [isHydrated, hydrate]);

  const clearAuth = useStore((state) => state.clearAuth);

  const fetchSpaces = useCallback(async () => {
    const currentToken = useStore.getState().token;
    if (!currentToken || typeof currentToken !== "string") return;
    try {
      const res = await fetch(`${API_BASE}/api/spaces`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.status === 401) { clearAuth(); return; }
      if (res.ok) setSpaces(await res.json());
    } catch (err) {
      console.error("Error fetching spaces:", err);
    }
  }, [clearAuth]);

  useEffect(() => {
    if (isHydrated && token && user) fetchSpaces();
  }, [isHydrated, token, user, fetchSpaces]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) { setError("Please enter a display name"); return; }
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const res = await fetch(`${API_BASE}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName.trim() }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (res.status === 429) throw new Error("Rate limited. Please wait a moment.");
      if (!res.ok) throw new Error("Failed to create guest account (" + res.status + ")");
      
      const data = await res.json();
      setAuth(data.token, data.user);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError("Network timeout. The server is not responding.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSeedSpace = async () => {
    setSeedingSpace(true);
    setSeedBanner(null);
    try {
      const res = await fetch(`${API_BASE}/api/dev/seed`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setSeedBanner({
          type: "ok",
          text: "Main Office is ready. List refreshed.",
        });
        fetchSpaces();
      } else {
        setSeedBanner({
          type: "err",
          text: data.error || `Could not sync demo space (${res.status})`,
        });
      }
    } catch {
      setSeedBanner({
        type: "err",
        text: "Network error. Check NEXT_PUBLIC_API_BASE and that the API is running.",
      });
    } finally {
      setSeedingSpace(false);
    }
  };

  const handleJoinSpace = (spaceId: string) => {
    router.push(`/activity?space=${spaceId}`);
  };

  if (!isHydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <p className="pixel-mono text-[var(--secondary)] text-sm animate-pulse tracking-widest">
          BOOT_SEQUENCE...
        </p>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--background)]">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 mb-2">
              <span className="pixel-badge-on" />
              <h1
                className="text-3xl font-bold tracking-tight"
                style={{ fontFamily: "'Share Tech Mono', monospace", color: "var(--primary-lit)" }}
              >
                SPHEREMEET
              </h1>
            </div>
            <p className="pixel-mono text-xs text-[var(--muted)] tracking-widest uppercase">
              Virtual Office Terminal v1.0
            </p>
          </div>

          {/* Login card */}
          <div
            className="pixel-frame pixel-shadow"
            style={{
              background: "var(--surface-mid)",
              padding: "2rem",
              border: "1px solid var(--outline-dim)",
            }}
          >
            <p className="pixel-mono text-xs text-[var(--secondary)] mb-6 uppercase tracking-widest">
              &gt; IDENTIFY_YOURSELF
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="displayName"
                  className="block pixel-mono text-xs text-[var(--muted)] mb-2 uppercase tracking-wider"
                >
                  Display Name
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter callsign..."
                  className="w-full px-4 py-3 pixel-mono text-sm text-[var(--foreground)] placeholder:text-[var(--outline)]"
                  style={{
                    background: "var(--surface-low)",
                    border: "1px solid var(--outline-dim)",
                    borderRadius: 0,
                    outline: "none",
                  }}
                  maxLength={50}
                  onFocus={(e) => (e.target.style.borderColor = "var(--secondary)")}
                  onBlur={(e) => (e.target.style.borderColor = "var(--outline-dim)")}
                />
              </div>

              {error && (
                <p className="pixel-mono text-xs text-red-400 tracking-wide">⚠ {error}</p>
              )}

              <button
                id="join-guest-btn"
                type="submit"
                disabled={loading}
                className="pixel-btn w-full py-3 px-4 font-semibold pixel-mono text-sm uppercase tracking-widest disabled:opacity-50"
                style={{
                  background: "var(--primary)",
                  color: "#fff",
                  borderBottom: "4px solid #312e81",
                }}
              >
                {loading ? "CONNECTING..." : "▶ JOIN AS GUEST"}
              </button>
            </form>
          </div>

          {/* Footer hint */}
          <p className="text-center pixel-mono text-xs text-[var(--outline)] mt-4 tracking-widest uppercase">
            Proximity audio/video enabled
          </p>
        </div>
      </div>
    );
  }

  /* ── Authenticated: Space Browser ── */
  return (
    <div className="min-h-screen bg-[var(--background)] p-6">
      {/* Top bar */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8 pb-4" style={{ borderBottom: "2px solid var(--outline-dim)" }}>
          <div className="flex items-center gap-3">
            <span className="pixel-badge-on" />
            <span
              className="text-xl font-bold tracking-tight"
              style={{ fontFamily: "'Share Tech Mono', monospace", color: "var(--primary-lit)" }}
            >
              SPHEREMEET
            </span>
            <span className="pixel-mono text-xs text-[var(--muted)] ml-2">
              / SPACE_BROWSER
            </span>
          </div>
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div
              className="pixel-frame px-3 py-1"
              style={{ background: "var(--surface-high)" }}
            >
              <span className="pixel-mono text-xs text-[var(--secondary)] tracking-widest uppercase">
                {user.display_name}
              </span>
            </div>
            <button
              id="create-demo-space-btn"
              type="button"
              onClick={handleSeedSpace}
              disabled={seedingSpace}
              className="pixel-btn px-4 py-2 pixel-mono text-xs uppercase tracking-widest disabled:opacity-50"
              style={{
                background: "var(--surface-highest)",
                color: "var(--foreground)",
                borderBottom: "4px solid var(--surface-low)",
              }}
            >
              {seedingSpace ? "SYNCING..." : "ENSURE MAIN OFFICE"}
            </button>
          </div>
        </div>

        {seedBanner && (
          <div
            className="mb-4 pixel-frame px-4 py-2 pixel-mono text-xs uppercase tracking-wider"
            style={{
              background:
                seedBanner.type === "ok"
                  ? "rgba(34, 197, 94, 0.12)"
                  : "rgba(239, 68, 68, 0.12)",
              borderColor:
                seedBanner.type === "ok" ? "#22c55e" : "#ef4444",
              color: seedBanner.type === "ok" ? "#86efac" : "#fca5a5",
            }}
          >
            {seedBanner.type === "ok" ? "OK — " : "ERR — "}
            {seedBanner.text}
          </div>
        )}

        {/* Section label */}
        <p className="pixel-mono text-xs text-[var(--muted)] uppercase tracking-widest mb-4">
          &gt; SELECT_SPACE — {spaces.length} AVAILABLE
        </p>

        {/* Spaces grid */}
        {spaces.length === 0 ? (
          <div
            className="pixel-frame text-center py-16 pixel-shadow"
            style={{ background: "var(--surface-mid)", border: "1px solid var(--outline-dim)" }}
          >
            <p className="pixel-mono text-sm text-[var(--muted)] mb-2">NO_SPACES_FOUND</p>
            <p className="pixel-mono text-xs text-[var(--outline)] uppercase tracking-widest">
              Main Office is created when the server starts — use &quot;ENSURE MAIN OFFICE&quot; to refresh the list
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {spaces.map((space) => (
              <button
                id={`join-space-${space.id}`}
                key={space.id}
                onClick={() => handleJoinSpace(space.id)}
                className="pixel-frame pixel-shadow group text-left w-full"
                style={{
                  background: "var(--surface-mid)",
                  border: "1px solid var(--outline-dim)",
                  padding: "1.25rem",
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--surface-high)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "var(--surface-mid)")
                }
              >
                {/* Pixel art floor thumbnail — procedural */}
                <div
                  className="w-full mb-3 overflow-hidden"
                  style={{ height: "80px", background: "var(--surface-low)" }}
                >
                  <svg width="100%" height="80" xmlns="http://www.w3.org/2000/svg">
                    {/* Checker floor */}
                    {Array.from({ length: 10 }, (_, col) =>
                      Array.from({ length: 3 }, (_, row) => (
                        <rect
                          key={`${col}-${row}`}
                          x={col * 32}
                          y={row * 27}
                          width={32}
                          height={27}
                          fill={(col + row) % 2 === 0 ? "#111827" : "#1f2933"}
                        />
                      ))
                    )}
                    {/* Desk */}
                    <rect x="20" y="18" width="48" height="14" fill="#4b5563" />
                    <rect x="20" y="14" width="6" height="4" fill="#374151" />
                    <rect x="62" y="14" width="6" height="4" fill="#374151" />
                    {/* Monitor */}
                    <rect x="36" y="10" width="16" height="10" fill="#1f2937" />
                    <rect x="38" y="11" width="12" height="7" fill="#6366f1" opacity="0.6" />
                    {/* Chair */}
                    <rect x="36" y="34" width="14" height="10" fill="#374151" />
                    {/* Zone border accent */}
                    <rect x="2" y="2" width="8" height="2" fill="#facc15" />
                    <rect x="2" y="2" width="2" height="8" fill="#facc15" />
                  </svg>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h3
                      className="font-semibold tracking-wide uppercase"
                      style={{ fontFamily: "'Share Tech Mono', monospace", color: "var(--secondary-lit)", fontSize: "0.85rem" }}
                    >
                      {space.name}
                    </h3>
                    <p className="pixel-mono text-xs text-[var(--muted)] mt-1 uppercase tracking-widest">
                      Click to join floor
                    </p>
                  </div>
                  <span
                    className="pixel-mono text-lg"
                    style={{ color: "var(--primary-lit)", transition: "transform 120ms" }}
                  >
                    ▶
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
