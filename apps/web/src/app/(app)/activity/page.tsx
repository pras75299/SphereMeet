"use client";

import {
  useEffect,
  useRef,
  useCallback,
  Suspense,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/store";
import { useWebSocketContext } from "@/hooks/WebSocketProvider";

const TILE_SIZE = 64;

// ─── Utilities ───────────────────────────────────────────────────────────────
const AVATAR_OUTFITS = [
  "#f97316", "#ec4899", "#eab308", "#22c55e", "#0ea5e9", "#a855f7",
];

function getZoneStyle(name: string | null | undefined) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes("kitchen")) return "kitchen";
  if (lower.includes("cafeteria") || lower.includes("cafe")) return "cafeteria";
  if (lower.includes("meeting") || lower.includes("room")) return "meeting";
  if (lower.includes("lounge") || lower.includes("sofa")) return "lounge";
  return null;
}

function getAvatarColor(id: string | null | undefined) {
  if (!id) return AVATAR_OUTFITS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_OUTFITS[hash % AVATAR_OUTFITS.length];
}

// ─── PeerVideo ───────────────────────────────────────────────────────────────
function PeerVideo({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => {});
  }, [stream]);
  if (!stream) return null;
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={false}
      className="w-full aspect-video bg-black object-cover"
      style={{ borderRadius: 0 }}
    />
  );
}

// ─── Pixel Art DOM Components ────────────────────────────────────────────────

function WallTile({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="absolute bg-[#020617] overflow-hidden"
      style={{
        left: x * TILE_SIZE,
        top: y * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      }}
    >
      {/* Brick texture lines */}
      {[0, 16, 32, 48].map((rowOffset, i) => (
        <div key={i} className="absolute w-full h-4" style={{ top: rowOffset }}>
          <div className="w-1/2 h-full inline-block bg-[#0d1117] border-b-2 border-r-2 border-[#010409]"></div>
          <div className="w-1/2 h-full inline-block bg-[#0d1117] border-b-2 border-[#010409]"></div>
        </div>
      ))}
    </div>
  );
}

function Avatar({
  x, y, color, dir, name, isSelf, isNearby
}: {
  x: number; y: number; color: string; dir: string; name: string; isSelf: boolean; isNearby: boolean;
}) {
  const left = x * TILE_SIZE + TILE_SIZE / 2 - 24; // 24 is half of 48px width
  const top = y * TILE_SIZE + TILE_SIZE / 2 - 32;  // 32 is half of 64px height

  let SpriteCore;
  if (dir === "up") {
    SpriteCore = (
      <div className="relative w-12 h-16 flex flex-col items-center z-30 drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
        <div className="w-8 h-8 bg-[#f5d0a1] border-2 border-slate-950"></div>
        <div className="w-10 h-6 border-2 border-slate-950 -mt-1" style={{ backgroundColor: color }}></div>
        <div className="flex gap-2 mt-auto">
          <div className="w-3 h-3 bg-slate-800 border-2 border-slate-950"></div>
          <div className="w-3 h-3 bg-slate-800 border-2 border-slate-950"></div>
        </div>
      </div>
    );
  } else if (dir === "left") {
    SpriteCore = (
      <div className="relative w-12 h-16 flex flex-col items-start ml-2 z-30 drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
        <div className="w-8 h-8 bg-[#f5d0a1] border-2 border-slate-950 relative">
          <div className="absolute top-4 left-1 w-1 h-1 bg-slate-950"></div>
        </div>
        <div className="w-8 h-6 border-2 border-slate-950 -mt-1 ml-1" style={{ backgroundColor: color }}></div>
        <div className="flex gap-1 mt-auto ml-1">
          <div className="w-3 h-3 bg-slate-800 border-2 border-slate-950"></div>
        </div>
      </div>
    );
  } else if (dir === "right") {
    SpriteCore = (
      <div className="relative w-12 h-16 flex flex-col items-end mr-2 z-30 drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
        <div className="w-8 h-8 bg-[#f5d0a1] border-2 border-slate-950 relative">
          <div className="absolute top-4 right-1 w-1 h-1 bg-slate-950"></div>
        </div>
        <div className="w-8 h-6 border-2 border-slate-950 -mt-1 mr-1" style={{ backgroundColor: color }}></div>
        <div className="flex gap-1 mt-auto mr-1">
          <div className="w-3 h-3 bg-slate-800 border-2 border-slate-950"></div>
        </div>
      </div>
    );
  } else {
    // down
    SpriteCore = (
      <div className="relative w-12 h-16 flex flex-col items-center z-30 drop-shadow-[2px_2px_0_rgba(0,0,0,0.5)]">
        <div className="w-8 h-8 bg-[#f5d0a1] border-2 border-slate-950 relative">
          <div className="absolute top-4 left-2 w-1 h-1 bg-slate-950"></div>
          <div className="absolute top-4 right-2 w-1 h-1 bg-slate-950"></div>
        </div>
        <div className="w-10 h-6 border-2 border-slate-950 -mt-1" style={{ backgroundColor: color }}></div>
        <div className="flex gap-2 mt-auto">
          <div className="w-3 h-3 bg-slate-800 border-2 border-slate-950"></div>
          <div className="w-3 h-3 bg-slate-800 border-2 border-slate-950"></div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute transition-all duration-200 ease-linear flex flex-col items-center"
      style={{ left, top, zIndex: 10 + y }}
    >
      {isSelf && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 border-2 border-indigo-400/30 rounded-full animate-pulse z-0 pointer-events-none"></div>
      )}
      {SpriteCore}
      {/* Name Badge */}
      <div
        className="mt-1 px-1.5 py-0.5 pixel-mono text-[8px] font-bold text-center uppercase tracking-widest whitespace-nowrap drop-shadow-md z-40"
        style={{
          background: isNearby ? "rgba(34,197,94,0.8)" : "rgba(11,15,25,0.8)",
          color: isNearby ? "#fff" : "#9ca3af",
          border: isSelf ? "1px solid var(--primary-lit)" : "1px solid var(--outline-dim)"
        }}
      >
        {name.substring(0, 10)}
      </div>
    </div>
  );
}

function ZoneOverlay({
  zone, type, isActive, activeUsersCount
}: {
  zone: { x: number; y: number; w: number; h: number; name: string | null };
  type: string;
  isActive: boolean;
  activeUsersCount: number;
}) {
  const zLeft = zone.x * TILE_SIZE;
  const zTop = zone.y * TILE_SIZE;
  const zWidth = zone.w * TILE_SIZE;
  const zHeight = zone.h * TILE_SIZE;

  let bgClass = "bg-slate-800/20";
  let borderClass = "border-slate-700/50";
  let labelBg = "bg-slate-800";
  let PropContent = null;

  if (type === "kitchen") {
    bgClass = "bg-[#3b2f2a]";
    borderClass = "border-[#4b3a30]";
    labelBg = "bg-amber-900";
    PropContent = (
      <>
        {/* Counter */}
        <div className="absolute top-0 right-0 w-full h-8 bg-[#4b3a30] border-b-4 border-[#2d2420]"></div>
        {/* Coffee Machine */}
        <div className="absolute top-0 right-8 w-16 h-12 bg-slate-800 border-b-4 border-black">
          <div className="w-4 h-2 bg-indigo-400 absolute top-2 right-2"></div>
        </div>
      </>
    );
  } else if (type === "cafeteria") {
    bgClass = "bg-[#123641]";
    borderClass = "border-[#0f2a34]";
    labelBg = "bg-teal-900";
    PropContent = (
      <div className="absolute flex gap-12 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {/* Cafe Table 1 */}
        <div className="relative">
          <div className="w-16 h-16 bg-[#0f2a34] rounded-full flex items-center justify-center">
            <div className="w-12 h-12 bg-slate-300 rounded-full"></div>
          </div>
          <div className="absolute -top-4 left-4 w-8 h-8 bg-slate-600 border-b-4 border-black"></div>
          <div className="absolute -bottom-4 left-4 w-8 h-8 bg-slate-600 border-b-4 border-black"></div>
        </div>
      </div>
    );
  } else if (type === "meeting") {
    bgClass = "bg-slate-900";
    borderClass = "border-slate-950";
    labelBg = "bg-indigo-900";
    PropContent = (
      <div className="absolute flex items-center justify-center w-full h-full">
        {/* Conference Table */}
        <div className="w-[80%] h-32 bg-[#1f2937] border-b-8 border-black/40"></div>
      </div>
    );
  } else if (type === "lounge") {
    bgClass = "bg-[#22172b]";
    borderClass = "border-[#2d1f3a]";
    labelBg = "bg-purple-900";
    PropContent = (
      <>
        {/* Sofa */}
        <div className="absolute bottom-12 left-12 flex">
          <div className="w-16 h-16 bg-[#a855f7] border-b-8 border-[#7e22ce]"></div>
          <div className="w-16 h-16 bg-[#a855f7] border-b-8 border-[#7e22ce]"></div>
        </div>
      </>
    );
  }

  // Active zone effect
  if (isActive) {
    borderClass = "border-amber-400";
    labelBg = "bg-amber-400";
  }

  return (
    <div
      className={`absolute ${bgClass} p-4 flex flex-col border-4 ${borderClass} shadow-[8px_8px_0_0_rgba(0,0,0,0.5)] overflow-hidden transition-colors duration-300 pointer-events-none z-0`}
      style={{
        left: zLeft, top: zTop, width: zWidth, height: zHeight
      }}
    >
      <div className={`absolute -top-4 left-6 px-3 py-1 border-2 border-slate-950 font-black text-xs tracking-tighter uppercase z-20 shadow-md ${labelBg} ${isActive ? 'text-slate-950' : 'text-white'}`}>
        {zone.name || "ZONE"}
      </div>
      {PropContent}
    </div>
  );
}


// ─── ActivityContent ─────────────────────────────────────────────────────────
function ActivityContent() {
  useSearchParams();
  const [currentZoneName, setCurrentZoneName] = useState<string | null>(null);
  const [commsExpanded, setCommsExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const user             = useStore((s) => s.user);
  const map              = useStore((s) => s.map);
  const zones            = useStore((s) => s.zones);
  const presence         = useStore((s) => s.presence);
  const proximityPeers   = useStore((s) => s.proximityPeers);
  const nearbyAvEnabled  = useStore((s) => s.nearbyAvEnabled);
  const setNearbyAvEnabled = useStore((s) => s.setNearbyAvEnabled);
  const localStream      = useStore((s) => s.localStream);
  const setLocalStream   = useStore((s) => s.setLocalStream);
  const peerConnections  = useStore((s) => s.peerConnections);
  const clearPeerConnections = useStore((s) => s.clearPeerConnections);
  const { sendMove }     = useWebSocketContext();

  // Auto-focus container so keyboard works immediately
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, [map]);

  const selfPresence = useMemo(
    () => (user ? presence.get(user.id) : null),
    [user, presence],
  );

  // Update current zone display
  useEffect(() => {
    if (!selfPresence) { setCurrentZoneName(null); return; }
    for (const zone of zones) {
      if (
        selfPresence.x >= zone.x && selfPresence.x < zone.x + zone.w &&
        selfPresence.y >= zone.y && selfPresence.y < zone.y + zone.h
      ) {
        setCurrentZoneName(zone.name ?? null);
        return;
      }
    }
    setCurrentZoneName(null);
  }, [selfPresence, zones]);

  // Keyboard controls
  useEffect(() => {
    if (!map || !user) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      const currentPresence = useStore.getState().presence.get(user.id);
      if (!currentPresence) return;

      let nx = currentPresence.x, ny = currentPresence.y, dir = currentPresence.dir;
      switch (e.key) {
        case "ArrowUp":    case "w": case "W": ny--; dir = "up";    break;
        case "ArrowDown":  case "s": case "S": ny++; dir = "down";  break;
        case "ArrowLeft":  case "a": case "A": nx--; dir = "left";  break;
        case "ArrowRight": case "d": case "D": nx++; dir = "right"; break;
        default: return;
      }
      e.preventDefault();
      // Blocked or out-of-bounds: still send facing dir so server stays in sync (no console spam)
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) {
        sendMove(currentPresence.x, currentPresence.y, dir);
        return;
      }
      if (map.blocked.includes(ny * map.width + nx)) {
        sendMove(currentPresence.x, currentPresence.y, dir);
        return;
      }
      sendMove(nx, ny, dir);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [map, user, sendMove]);

  // A/V handlers
  const handleEnableNearbyAV = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Your browser does not support camera/microphone access.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      setLocalStream(stream);
      setNearbyAvEnabled(true);
    } catch (err: unknown) {
      alert("Could not access camera/microphone.");
    }
  }, [setLocalStream, setNearbyAvEnabled]);

  const handleDisableNearbyAV = useCallback(() => {
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    clearPeerConnections();
    setNearbyAvEnabled(false);
  }, [localStream, setLocalStream, clearPeerConnections, setNearbyAvEnabled]);

  // If map hasn't loaded (e.g., still connecting to websocket), show boot sequence overlay.
  // Note: layout.tsx handles missing spaceId redirect, so we know map will eventually load unless space was deleted.
  if (!map) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[var(--background)] px-4 py-8">
        <p className="pixel-mono text-sm text-[var(--secondary)] animate-pulse tracking-widest uppercase mb-6">
          INIT_WORLD_STATE...
        </p>
        <button 
          onClick={() => window.location.href = '/'}
          className="pixel-btn px-6 py-2 pixel-mono text-xs uppercase font-bold"
          style={{ background: "#7f1d1d", color: "#fca5a5", borderBottom: "4px solid #450a0a" }}
        >
          ABORT & RETURN
        </button>
      </div>
    );
  }

  // Camera logic: keep local user centered
  const camX = selfPresence ? selfPresence.x * TILE_SIZE + TILE_SIZE / 2 : (map.width * TILE_SIZE) / 2;
  const camY = selfPresence ? selfPresence.y * TILE_SIZE + TILE_SIZE / 2 : (map.height * TILE_SIZE) / 2;
  
  // Create an array of WallTile coordinates to render safely inside JSX
  const wallCoords = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.blocked.includes(y * map.width + x)) {
        wallCoords.push({ x, y });
      }
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative h-full min-h-0 w-full flex-1 outline-none"
      style={{ background: "var(--background)" }}
    >
      {/* Full-bleed map (entire main area under app header) */}
      <div className="absolute inset-0 overflow-hidden" style={{ isolation: "isolate" }}>
        {/* Retro CRT Scanline Overlay inside Viewport */}
        <div 
          className="absolute inset-0 pointer-events-none z-50 opacity-20" 
          style={{
            background: "linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%)",
            backgroundSize: "100% 4px"
          }}
        ></div>

        {/* The DOM Pixel Grid World Map */}
        <div 
          className="absolute transition-transform duration-200 ease-linear shadow-2xl"
          style={{
            width: map.width * TILE_SIZE,
            height: map.height * TILE_SIZE,
            // Center the camera on the user
            left: "50%",
            top: "50%",
            transform: `translate(-${camX}px, -${camY}px)`,
            backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
            backgroundColor: "#0d1117" // base floor color
          }}
        >
          {/* 1. Zone Overlays */}
          {zones.map((zone) => {
            const zStyle = getZoneStyle(zone.name);
            if (!zStyle) return null;
            const isActive = selfPresence &&
              selfPresence.x >= zone.x && selfPresence.x < zone.x + zone.w &&
              selfPresence.y >= zone.y && selfPresence.y < zone.y + zone.h;
            return (
              <ZoneOverlay
                key={zone.zone_id}
                zone={zone}
                type={zStyle}
                isActive={isActive as boolean}
                activeUsersCount={Array.from(presence.values()).filter(p => p.zone_id === zone.zone_id).length}
              />
            );
          })}

          {/* 2. Wall Blocks */}
          {wallCoords.map(({x, y}) => (
            <WallTile key={`${x},${y}`} x={x} y={y} />
          ))}

          {/* 3. Avatars */}
          {Array.from(presence.values()).map((p) => {
            const isSelf = user != null && p.user_id === user.id;
            const isNearby = proximityPeers.includes(p.user_id);
            const color = isSelf ? "var(--primary)" : isNearby ? "#22c55e" : getAvatarColor(p.user_id);
            return (
              <Avatar
                key={p.user_id}
                x={p.x}
                y={p.y}
                dir={p.dir}
                name={p.display_name}
                color={color}
                isSelf={isSelf}
                isNearby={isNearby}
              />
            );
          })}
        </div>

        {/* HUD Elements anchored to viewport */}
        {currentZoneName && (
          <div className="absolute bottom-10 left-6 px-4 py-2 pixel-frame pixel-mono text-xs shadow-lg uppercase tracking-widest bg-amber-400 bg-opacity-20 border-2 border-amber-400 text-amber-400 z-50">
            ▶ IN_ZONE: {currentZoneName}
          </div>
        )}

        <div className="absolute bottom-4 left-6 px-3 py-1.5 pixel-frame pixel-mono text-[10px] uppercase tracking-widest bg-slate-900 bg-opacity-80 text-[var(--muted)] border border-slate-700 z-50 pointer-events-none">
          WASD / ↑↓←→ TO MOVE
        </div>
      </div>

      {/* Overlay COMMS panel (does not shrink the map — floats on top) */}
      <div
        className="absolute top-0 right-0 bottom-0 z-40 flex h-full min-h-0 flex-col border-l-2 shadow-[-6px_0_16px_rgba(0,0,0,0.45)] transition-[width] duration-200 ease-out"
        style={{
          width: commsExpanded ? "18rem" : "2.75rem",
          background: "var(--surface-low)",
          borderColor: "var(--outline-dim)",
        }}
      >
        {!commsExpanded ? (
          <button
            type="button"
            onClick={() => setCommsExpanded(true)}
            className="flex h-full w-full flex-col items-center justify-center gap-3 px-1 pixel-mono text-[9px] font-bold uppercase tracking-widest text-[var(--secondary-lit)] hover:bg-[var(--surface-mid)]"
            style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
            aria-label="Open comms panel"
          >
            COMMS ▶
          </button>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: "2px solid var(--outline-dim)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <span className={nearbyAvEnabled ? "pixel-badge-on" : "pixel-badge-off"} />
            <span className="pixel-mono text-xs font-bold uppercase tracking-widest truncate" style={{ color: "var(--secondary-lit)" }}>
              COMMS_HUD
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCommsExpanded(false)}
            className="pixel-btn shrink-0 px-2 py-1 pixel-mono text-[10px] uppercase tracking-widest"
            style={{ background: "var(--surface-lowest)", color: "var(--muted)" }}
            aria-label="Collapse comms panel"
          >
            ◀
          </button>
        </div>

        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--outline-dim)" }}>
          {nearbyAvEnabled ? (
            <button
              id="disable-av-btn"
              onClick={handleDisableNearbyAV}
              className="pixel-btn w-full py-2 px-4 pixel-mono text-[10px] uppercase tracking-widest font-bold"
              style={{ background: "#7f1d1d", color: "#fca5a5", borderBottom: "4px solid #450a0a" }}
            >
              ■ DISABLE A/V
            </button>
          ) : (
            <button
              id="enable-av-btn"
              onClick={handleEnableNearbyAV}
              className="pixel-btn w-full py-2 px-4 pixel-mono text-[10px] uppercase tracking-widest font-bold"
              style={{ background: "var(--primary)", color: "#fff", borderBottom: "4px solid #312e81" }}
            >
              ▶ ENABLE A/V
            </button>
          )}
        </div>

        {nearbyAvEnabled && localStream && (
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--outline-dim)" }}>
            <p className="pixel-mono text-[10px] text-[var(--muted)] mb-1 uppercase tracking-widest">LOCAL_FEED</p>
            <div style={{ border: "2px solid var(--outline-dim)" }}>
              <video
                autoPlay muted playsInline
                ref={(el) => { if (el && localStream) el.srcObject = localStream; }}
                className="w-full aspect-video bg-black object-cover"
                style={{ borderRadius: 0 }}
              />
            </div>
          </div>
        )}

        <div className="px-4 py-3" style={{ background: "var(--surface-lowest, #0a0e18)", borderBottom: "1px solid var(--outline-dim)" }}>
          <p className="pixel-mono text-[10px] text-[var(--muted)] mb-2 uppercase tracking-widest">STATUS_READOUT</p>
          {[
            ["A/V",    nearbyAvEnabled ? "ENABLED"  : "DISABLED",  nearbyAvEnabled ? "#22c55e" : "#facc15"],
            ["CAM",    localStream     ? "ACTIVE"   : "INACTIVE",  localStream     ? "#22c55e" : "#ef4444"],
            ["NEARBY", String(proximityPeers.length), "var(--foreground)"],
            ["CONN",   String(peerConnections.size),  "var(--foreground)"],
          ].map(([label, value, color]) => (
            <div key={label} className="flex justify-between items-center mb-1">
              <span className="pixel-mono text-[10px] text-[var(--muted)] uppercase tracking-wider">{label}:</span>
              <span className="pixel-mono text-[10px] font-bold" style={{ color }}>{value}</span>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 bg-[var(--surface-low)]">
          <p className="pixel-mono text-[10px] text-[var(--muted)] mb-3 uppercase tracking-widest">NEARBY ({proximityPeers.length})</p>
          {proximityPeers.length === 0 ? (
            <div className="space-y-1">
              <p className="pixel-mono text-[10px] text-[var(--outline)]">Move closer to others</p>
              <p className="pixel-mono text-[10px] text-[var(--outline)]">Proximity: 4 tiles</p>
            </div>
          ) : (
            <div className="space-y-3">
              {proximityPeers.map((peerId) => {
                const peerPresence   = presence.get(peerId);
                const peerConnection = peerConnections.get(peerId);
                const connState      = peerConnection?.pc?.connectionState || "none";
                const badgeColor = connState === "connected" ? "#22c55e" : connState === "connecting" ? "#facc15" : connState === "failed" ? "#ef4444" : "#6b7280";
                return (
                  <div key={peerId} className="space-y-1 p-2" style={{ background: "var(--surface-mid)", border: "2px solid var(--outline-dim)" }}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="pixel-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--secondary-lit)" }}>
                        {(peerPresence?.display_name || "UNKNOWN").slice(0, 10).toUpperCase()}
                      </p>
                      <span className="pixel-mono text-[9px] px-1.5 py-0.5" style={{ background: `${badgeColor}22`, color: badgeColor }}>
                        {connState.toUpperCase()}
                      </span>
                    </div>
                    {peerConnection?.remoteStream ? (
                      <div style={{ border: "2px solid var(--outline-dim)" }}>
                        <PeerVideo stream={peerConnection.remoteStream} />
                      </div>
                    ) : (
                      <div className="w-full aspect-video flex items-center justify-center flex-col gap-1" style={{ background: "var(--surface-lowest, #0a0e18)" }}>
                        <span className="pixel-mono text-[10px] text-[var(--outline)] uppercase tracking-wider">
                          {!nearbyAvEnabled ? "ENABLE_AV" : connState === "none" ? "WAITING..." : connState === "connecting" ? "LINKING..." : connState === "failed" ? "CONN_FAIL" : "NO_SIGNAL"}
                        </span>
                        {!nearbyAvEnabled && (
                          <span className="pixel-mono text-[9px]" style={{ color: "var(--secondary)" }}>
                            Both must enable A/V
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
          <p className="pixel-mono text-sm text-[var(--secondary)] animate-pulse tracking-widest uppercase">
            LOADING_MAP...
          </p>
        </div>
      }
    >
      <ActivityContent />
    </Suspense>
  );
}
