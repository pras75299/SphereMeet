"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

type AuthTab = "login" | "register";

export default function HomePage() {
  const router = useRouter();

  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const setAuth = useStore((state) => state.setAuth);
  const clearAuth = useStore((state) => state.clearAuth);
  const isHydrated = useStore((state) => state.isHydrated);
  const hydrate = useStore((state) => state.hydrate);

  const [authTab, setAuthTab] = useState<AuthTab>("login");

  // Reset the tab to "login" whenever the user is logged out so that after
  // a register→logout flow the form always shows the login screen.
  useEffect(() => {
    if (isHydrated && !token) setAuthTab("login");
  }, [isHydrated, token]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [spaces, setSpaces] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [seedingSpace, setSeedingSpace] = useState(false);
  const [seedBanner, setSeedBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!isHydrated) hydrate();
  }, [isHydrated, hydrate]);

  const fetchSpaces = useCallback(async () => {
    const currentToken = useStore.getState().token;
    if (!currentToken || typeof currentToken !== "string") return;
    setLoadingSpaces(true);
    try {
      const res = await fetch(`${API_BASE}/api/spaces`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.status === 401) { clearAuth(); return; }
      if (res.ok) setSpaces(await res.json());
    } catch (err) {
      console.error("Error fetching spaces:", err);
    } finally {
      setLoadingSpaces(false);
    }
  }, [clearAuth]);

  useEffect(() => {
    if (isHydrated && token && user) fetchSpaces();
  }, [isHydrated, token, user, fetchSpaces]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }
    if (password.length < 1 || password.length > 128) {
      setError("Password must be 1-128 characters");
      return;
    }
    if (authTab === "register" && (!displayName.trim() || displayName.trim().length > 50)) {
      setError("Display name must be 1-50 characters");
      return;
    }

    setLoading(true);
    try {
      const endpoint = authTab === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        authTab === "login"
          ? { email: email.trim(), password }
          : { email: email.trim(), password, display_name: displayName.trim() };

      // Attempt the request up to 2 times to handle Render free-tier cold starts
      // (first request wakes the dyno; second request completes normally).
      let res: Response | null = null;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        // 25 s per attempt — enough for Render cold start + Argon2 hashing.
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        try {
          res = await fetch(`${API_BASE}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          break; // success — stop retrying
        } catch (err) {
          clearTimeout(timeoutId);
          lastErr = err;
          if ((err as { name?: string }).name === "AbortError" && attempt === 0) {
            // First attempt timed out — likely a cold start. Show hint and retry.
            setError("Server is waking up — retrying…");
            continue;
          }
          throw err; // propagate on second failure
        }
      }

      if (!res) throw lastErr;

      if (res.status === 429) throw new Error("Rate limited. Please wait a moment.");
      if (res.status === 401) throw new Error("Invalid email or password.");

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      setError("");
      setAuth(data.token, data.user);
    } catch (err: unknown) {
      if ((err as { name?: string }).name === "AbortError") {
        setError("Server did not respond. Check that the API is running.");
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
        await fetchSpaces();
        setSeedBanner({ type: "ok", text: "Main Office is ready. List refreshed." });
      } else {
        setSeedBanner({ type: "err", text: data.error || `Could not sync demo space (${res.status})` });
      }
    } catch {
      setSeedBanner({ type: "err", text: "Network error. Check NEXT_PUBLIC_API_BASE." });
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

  /* ── Auth screen ── */
  if (!token || !user) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4"
        style={{
          background: "var(--background)",
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(192,193,255,0.03) 2px, rgba(192,193,255,0.03) 4px)",
        }}
      >
        <div className="w-full max-w-sm">
          {/* Logo */}
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

          {/* Card — background shift + L-corner accents, no line borders */}
          <div
            className="pixel-frame"
            style={{
              background: "var(--surface-mid)",
              boxShadow: "4px 4px 0px var(--background)",
            }}
          >
            {/* Tab bar — surface-low vs surface-mid colour shift is the division */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                background: "var(--surface-low)",
              }}
            >
              {(["login", "register"] as AuthTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => { setAuthTab(tab); setError(""); }}
                  className="pixel-mono text-xs tracking-widest uppercase py-3 px-4"
                  style={{
                    color: authTab === tab ? "var(--secondary)" : "var(--muted)",
                    background: authTab === tab ? "var(--surface-mid)" : "transparent",
                    borderBottom: authTab === tab ? "2px solid var(--secondary)" : "2px solid transparent",
                    marginBottom: "-2px",
                    cursor: "pointer",
                    transition: "color 120ms",
                  }}
                >
                  {tab === "login" ? "▷ LOGIN" : "+ REGISTER"}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleAuth} style={{ padding: "1.75rem" }}>
              <p className="pixel-mono text-xs text-[var(--secondary)] mb-5 uppercase tracking-widest">
                &gt; {authTab === "login" ? "AUTHENTICATE_OPERATOR" : "ENROLL_NEW_OPERATOR"}
              </p>

              <div className="space-y-4">
                {authTab === "register" && (
                  <div>
                    <label htmlFor="displayNameInput" className="block pixel-mono text-xs text-[var(--muted)] mb-2 uppercase tracking-wider">
                      Callsign / Display Name
                    </label>
                    <input
                      id="displayNameInput"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter callsign..."
                      className="pixel-input w-full px-4 py-3 text-sm"
                      maxLength={50}
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="emailInput" className="block pixel-mono text-xs text-[var(--muted)] mb-2 uppercase tracking-wider">
                    Email
                  </label>
                  <input
                    id="emailInput"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operator@domain.io"
                    className="pixel-input w-full px-4 py-3 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="passwordInput" className="block pixel-mono text-xs text-[var(--muted)] mb-2 uppercase tracking-wider">
                    Password
                  </label>
                  <input
                    id="passwordInput"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pixel-input w-full px-4 py-3 text-sm"
                    maxLength={128}
                  />
                  {authTab === "register" && (
                    <p className="pixel-mono text-xs text-[var(--outline)] mt-1 tracking-wide">
                      MIN 8 CHARS
                    </p>
                  )}
                </div>
              </div>

              {error && (
                <div
                  className="mt-4 px-3 py-2 pixel-mono text-xs tracking-wide"
                  style={{
                    background: "rgba(239,68,68,0.10)",
                    outline: "1px solid rgba(239,68,68,0.35)",
                    color: "#fca5a5",
                  }}
                >
                  ⚠ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="pixel-btn w-full mt-5 py-3 px-4 font-semibold pixel-mono text-sm uppercase tracking-widest disabled:opacity-50"
                style={{
                  background: "var(--primary)",
                  color: "#fff",
                  borderRadius: 0,
                  border: "none",
                  borderBottom: "4px solid #312e81",
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "transform 80ms",
                }}
                onMouseDown={(e) => {
                  if (!loading) {
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(2px)";
                    (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "2px";
                  }
                }}
                onMouseUp={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "";
                  (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "4px";
                }}
              >
                {loading
                  ? "CONNECTING..."
                  : authTab === "login"
                  ? "▶ AUTHENTICATE"
                  : "▶ ENROLL"}
              </button>

              <p className="text-center pixel-mono text-xs text-[var(--outline)] mt-4 tracking-widest uppercase">
                {authTab === "login" ? (
                  <>
                    No account?{" "}
                    <button
                      type="button"
                      onClick={() => { setAuthTab("register"); setError(""); }}
                      className="text-[var(--secondary)] underline-offset-2 underline cursor-pointer"
                    >
                      REGISTER
                    </button>
                  </>
                ) : (
                  <>
                    Have an account?{" "}
                    <button
                      type="button"
                      onClick={() => { setAuthTab("login"); setError(""); }}
                      className="text-[var(--secondary)] underline-offset-2 underline cursor-pointer"
                    >
                      LOGIN
                    </button>
                  </>
                )}
              </p>
            </form>
          </div>

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
            <button
              type="button"
              onClick={clearAuth}
              className="pixel-btn px-4 py-2 pixel-mono text-xs uppercase tracking-widest"
              style={{
                background: "rgba(239,68,68,0.12)",
                color: "#fca5a5",
                outline: "1px solid rgba(239,68,68,0.25)",
                borderBottom: "4px solid rgba(239,68,68,0.3)",
              }}
            >
              LOGOUT
            </button>
          </div>
        </div>

        {seedBanner && (
          <div
            className="mb-4 pixel-frame px-4 py-2 pixel-mono text-xs uppercase tracking-wider"
            style={{
              background: seedBanner.type === "ok" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
              borderColor: seedBanner.type === "ok" ? "#22c55e" : "#ef4444",
              color: seedBanner.type === "ok" ? "#86efac" : "#fca5a5",
            }}
          >
            {seedBanner.type === "ok" ? "OK — " : "ERR — "}
            {seedBanner.text}
          </div>
        )}

        <p className="pixel-mono text-xs text-[var(--muted)] uppercase tracking-widest mb-4">
          &gt; SELECT_SPACE — {spaces.length} AVAILABLE
        </p>

        {loadingSpaces ? (
          <div
            className="pixel-frame text-center py-16"
            style={{ background: "var(--surface-mid)", border: "1px solid var(--outline-dim)" }}
          >
            <p className="pixel-mono text-sm text-[var(--secondary)] animate-pulse uppercase tracking-widest">
              LOADING_SPACES...
            </p>
          </div>
        ) : spaces.length === 0 ? (
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
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-high)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-mid)")}
              >
                <div
                  className="w-full mb-3 overflow-hidden"
                  style={{ height: "80px", background: "var(--surface-low)" }}
                >
                  <svg width="100%" height="80" xmlns="http://www.w3.org/2000/svg">
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
                    <rect x="20" y="18" width="48" height="14" fill="#4b5563" />
                    <rect x="20" y="14" width="6" height="4" fill="#374151" />
                    <rect x="62" y="14" width="6" height="4" fill="#374151" />
                    <rect x="36" y="10" width="16" height="10" fill="#1f2937" />
                    <rect x="38" y="11" width="12" height="7" fill="#6366f1" opacity="0.6" />
                    <rect x="36" y="34" width="14" height="10" fill="#374151" />
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
