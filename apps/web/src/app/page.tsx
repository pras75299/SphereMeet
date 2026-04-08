"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

const MAX_USER_SPACES = 3;

const DEMO_ACCOUNTS = [
  { label: "Alice", email: "alice@spheremeet.demo", password: "demo1234" },
  { label: "Bob",   email: "bob@spheremeet.demo",   password: "demo1234" },
];

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

  // Create space state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState("");
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [createError, setCreateError] = useState("");

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
    const minPassword = authTab === "register" ? 8 : 1;
    if (password.length < minPassword || password.length > 128) {
      setError(authTab === "register" ? "Password must be 8-128 characters" : "Password must be 1-128 characters");
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

      let res: Response | null = null;
      let lastErr: unknown = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        try {
          res = await fetch(`${API_BASE}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          break;
        } catch (err) {
          clearTimeout(timeoutId);
          lastErr = err;
          if ((err as { name?: string }).name === "AbortError" && attempt === 0) {
            setError("Server is waking up — retrying…");
            continue;
          }
          throw err;
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
        setSeedBanner({ type: "ok", text: "Main Office is ready." });
      } else {
        setSeedBanner({ type: "err", text: data.error || `Could not sync demo space (${res.status})` });
      }
    } catch {
      setSeedBanner({ type: "err", text: "Network error. Check NEXT_PUBLIC_API_BASE." });
    } finally {
      setSeedingSpace(false);
    }
  };

  const handleCreateSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    const name = newSpaceName.trim();
    if (!name) { setCreateError("Space name is required"); return; }
    if (name.length > 50) { setCreateError("Name must be 50 characters or fewer"); return; }

    setCreatingSpace(true);
    try {
      const res = await fetch(`${API_BASE}/api/spaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${useStore.getState().token}`,
        },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setNewSpaceName("");
      setShowCreateForm(false);
      await fetchSpaces();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create space");
    } finally {
      setCreatingSpace(false);
    }
  };

  const handleJoinSpace = (spaceId: string) => {
    router.push(`/activity?space=${spaceId}`);
  };

  const fillDemo = (account: typeof DEMO_ACCOUNTS[0]) => {
    setAuthTab("login");
    setEmail(account.email);
    setPassword(account.password);
    setError("");
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

          {/* Demo accounts */}
          <div
            className="mb-5 px-4 py-3"
            style={{
              background: "var(--surface-mid)",
              boxShadow: "4px 4px 0px var(--background)",
            }}
          >
            <p className="pixel-mono text-xs text-[var(--muted)] uppercase tracking-widest mb-3">
              Demo accounts
            </p>
            <div className="flex flex-col gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <div key={acc.email} className="flex items-center justify-between gap-3">
                  <div>
                    <span
                      className="text-sm font-medium"
                      style={{ color: "var(--foreground)", fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {acc.label}
                    </span>
                    <span
                      className="block text-xs mt-0.5"
                      style={{ color: "var(--muted)", fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {acc.email} · demo1234
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fillDemo(acc)}
                    className="pixel-btn px-3 py-1 pixel-mono text-xs uppercase tracking-widest flex-shrink-0"
                    style={{
                      background: "var(--surface-highest)",
                      color: "var(--secondary)",
                      borderBottom: "3px solid var(--surface-low)",
                    }}
                    onMouseDown={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.transform = "translateY(2px)";
                      (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "1px";
                    }}
                    onMouseUp={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.transform = "";
                      (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "3px";
                    }}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Auth card */}
          <div
            className="pixel-frame"
            style={{
              background: "var(--surface-mid)",
              boxShadow: "4px 4px 0px var(--background)",
            }}
          >
            {/* Tab bar */}
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
                  {tab === "login" ? "▷ Login" : "+ Register"}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleAuth} style={{ padding: "1.75rem" }}>
              <p
                className="text-sm mb-5"
                style={{ color: "var(--foreground)", fontFamily: "'Space Grotesk', sans-serif", lineHeight: 1.5 }}
              >
                {authTab === "login"
                  ? "Sign in to your account"
                  : "Create a new account"}
              </p>

              <div className="space-y-4">
                {authTab === "register" && (
                  <div>
                    <label htmlFor="displayNameInput" className="block pixel-mono text-xs text-[var(--muted)] mb-2 uppercase tracking-wider">
                      Display Name
                    </label>
                    <input
                      id="displayNameInput"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
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
                    placeholder="you@example.com"
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
                    <p className="text-xs mt-1" style={{ color: "var(--outline)", fontFamily: "'Space Grotesk', sans-serif" }}>
                      At least 8 characters
                    </p>
                  )}
                </div>
              </div>

              {error && (
                <div
                  className="mt-4 px-3 py-2 text-sm"
                  style={{
                    background: "rgba(239,68,68,0.10)",
                    outline: "1px solid rgba(239,68,68,0.35)",
                    color: "#fca5a5",
                    fontFamily: "'Space Grotesk', sans-serif",
                    lineHeight: 1.5,
                  }}
                >
                  {error}
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
                  ? "Connecting..."
                  : authTab === "login"
                  ? "▶ Sign In"
                  : "▶ Create Account"}
              </button>

              <p
                className="text-center text-xs mt-4"
                style={{ color: "var(--outline)", fontFamily: "'Space Grotesk', sans-serif" }}
              >
                {authTab === "login" ? (
                  <>
                    No account?{" "}
                    <button
                      type="button"
                      onClick={() => { setAuthTab("register"); setError(""); }}
                      className="text-[var(--secondary)] underline-offset-2 underline cursor-pointer"
                    >
                      Register
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => { setAuthTab("login"); setError(""); }}
                      className="text-[var(--secondary)] underline-offset-2 underline cursor-pointer"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </form>
          </div>

          <p className="text-center text-xs text-[var(--outline)] mt-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Proximity audio & video enabled
          </p>
        </div>
      </div>
    );
  }

  /* ── Authenticated: Space Browser ── */
  return (
    <div className="min-h-screen bg-[var(--background)] p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 pb-4" style={{ borderBottom: "2px solid var(--outline-dim)" }}>
          <div className="flex items-center gap-3">
            <span className="pixel-badge-on" />
            <span
              className="text-xl font-bold tracking-tight"
              style={{ fontFamily: "'Share Tech Mono', monospace", color: "var(--primary-lit)" }}
            >
              SPHEREMEET
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
              {seedingSpace ? "Syncing..." : "Sync Demo Space"}
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
              Sign Out
            </button>
          </div>
        </div>

        {seedBanner && (
          <div
            className="mb-4 px-4 py-2 text-sm"
            style={{
              background: seedBanner.type === "ok" ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
              outline: `1px solid ${seedBanner.type === "ok" ? "#22c55e" : "#ef4444"}`,
              color: seedBanner.type === "ok" ? "#86efac" : "#fca5a5",
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {seedBanner.text}
          </div>
        )}

        {/* Spaces heading + create button */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "var(--foreground)", fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Spaces
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)", fontFamily: "'Space Grotesk', sans-serif" }}>
              {spaces.length} available · You can create up to {MAX_USER_SPACES}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowCreateForm((v) => !v); setCreateError(""); setNewSpaceName(""); }}
            className="pixel-btn px-4 py-2 pixel-mono text-xs uppercase tracking-widest"
            style={{
              background: showCreateForm ? "var(--surface-highest)" : "var(--primary)",
              color: showCreateForm ? "var(--foreground)" : "#fff",
              borderBottom: `4px solid ${showCreateForm ? "var(--surface-low)" : "#312e81"}`,
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(2px)";
              (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "2px";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = "";
              (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "4px";
            }}
          >
            {showCreateForm ? "✕ Cancel" : "+ New Space"}
          </button>
        </div>

        {/* Create space inline form */}
        {showCreateForm && (
          <form
            onSubmit={handleCreateSpace}
            className="mb-5 px-4 py-4"
            style={{ background: "var(--surface-mid)", boxShadow: "4px 4px 0px var(--background)" }}
          >
            <p className="pixel-mono text-xs text-[var(--muted)] uppercase tracking-widest mb-3">
              New space
            </p>
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <input
                  type="text"
                  value={newSpaceName}
                  onChange={(e) => setNewSpaceName(e.target.value)}
                  placeholder="Space name"
                  className="pixel-input w-full px-4 py-3 text-sm"
                  maxLength={50}
                  autoFocus
                />
                {createError && (
                  <p className="text-xs mt-1" style={{ color: "#fca5a5", fontFamily: "'Space Grotesk', sans-serif" }}>
                    {createError}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={creatingSpace}
                className="pixel-btn px-4 py-3 pixel-mono text-xs uppercase tracking-widest disabled:opacity-50 flex-shrink-0"
                style={{
                  background: "var(--primary)",
                  color: "#fff",
                  borderBottom: "4px solid #312e81",
                }}
                onMouseDown={(e) => {
                  if (!creatingSpace) {
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(2px)";
                    (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "2px";
                  }
                }}
                onMouseUp={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "";
                  (e.currentTarget as HTMLButtonElement).style.borderBottomWidth = "4px";
                }}
              >
                {creatingSpace ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        )}

        {/* Spaces list */}
        {loadingSpaces ? (
          <div
            className="pixel-frame text-center py-16"
            style={{ background: "var(--surface-mid)" }}
          >
            <p className="text-sm animate-pulse" style={{ color: "var(--secondary)", fontFamily: "'Space Grotesk', sans-serif" }}>
              Loading spaces...
            </p>
          </div>
        ) : spaces.length === 0 ? (
          <div
            className="pixel-frame text-center py-16 pixel-shadow"
            style={{ background: "var(--surface-mid)" }}
          >
            <p className="text-sm mb-2" style={{ color: "var(--muted)", fontFamily: "'Space Grotesk', sans-serif" }}>
              No spaces found
            </p>
            <p className="text-xs" style={{ color: "var(--outline)", fontFamily: "'Space Grotesk', sans-serif" }}>
              Use &quot;Sync Demo Space&quot; to create the default office, or create your own above.
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
                      className="font-semibold"
                      style={{ fontFamily: "'Share Tech Mono', monospace", color: "var(--secondary-lit)", fontSize: "0.9rem" }}
                    >
                      {space.name}
                    </h3>
                    <p className="text-xs mt-1" style={{ color: "var(--muted)", fontFamily: "'Space Grotesk', sans-serif" }}>
                      Click to enter
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
