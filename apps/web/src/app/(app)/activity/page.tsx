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

const TILE_SIZE = 32;

// ─── Bit-Level Office palette (matches design system tokens) ───────────────
const PALETTE = {
  background:         "#0b0f19",
  corridorFloorDark:  "#111827",
  corridorFloorLight: "#1f2933",
  wall:               "#020617",
  wallHighlight:      "#0d1117",
  wallShadow:         "#010409",
  kitchenFloorA:      "#3b2f2a",
  kitchenFloorB:      "#4b3a30",
  cafeteriaFloorA:    "#123641",
  cafeteriaFloorB:    "#0f2a34",
  meetingFloor:       "#101827",
  loungeFloorA:       "#22172b",
  loungeFloorB:       "#2d1f3a",
  zoneStrokeDefault:  "#4b5563",
  zoneStrokeActive:   "#facc15",
  zoneLabelDefault:   "#9ca3af",
  zoneLabelActive:    "#facc15",
  avatarSelf:         "#6366f1",
  avatarNearby:       "#22c55e",
  avatarOutline:      "#020617",
  avatarHead:         "#f9fafb",
  // Furniture
  counterSurface:     "#6b7280",
  counterEdge:        "#4b5563",
  deskSurface:        "#4b5563",
  deskLeg:            "#374151",
  monitorFrame:       "#1f2937",
  monitorScreen:      "#6366f1",
  sofaBody:           "#7e22ce",
  sofaBack:           "#6b21a8",
  coffeeMachine:      "#374151",
  coffeeLight:        "#22c55e",
  cafeTable:          "#0ea5e9",
  cafeTableEdge:      "#0284c7",
  meetingTable:       "#1e293b",
  meetingTableEdge:   "#334155",
  whiteboardSurface:  "#e2e8f0",
  whiteboardMarker:   "#6366f1",
  plantPot:           "#92400e",
  plantLeaf:          "#16a34a",
};

const AVATAR_OUTFITS = [
  "#f97316", "#ec4899", "#eab308", "#22c55e", "#0ea5e9", "#a855f7",
];

function getZoneStyle(name: string | null | undefined) {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (lower.includes("kitchen"))                           return { type: "kitchen"  as const };
  if (lower.includes("cafeteria") || lower.includes("cafe")) return { type: "cafeteria" as const };
  if (lower.includes("meeting")   || lower.includes("room"))  return { type: "meeting"  as const };
  if (lower.includes("lounge")    || lower.includes("sofa"))  return { type: "lounge"   as const };
  return null;
}

function getAvatarColor(id: string | null | undefined) {
  if (!id) return AVATAR_OUTFITS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_OUTFITS[hash % AVATAR_OUTFITS.length];
}

// ─── Draw pixel-art wall tile ───────────────────────────────────────────────
function drawWallTile(ctx: CanvasRenderingContext2D, px: number, py: number) {
  // Base
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  // Brick rows
  const brickH = 8;
  for (let row = 0; row < TILE_SIZE / brickH; row++) {
    const offset = (row % 2) * (TILE_SIZE / 4);
    ctx.fillStyle = PALETTE.wallHighlight;
    ctx.fillRect(px + offset, py + row * brickH, TILE_SIZE / 2 - 1, brickH - 1);
    ctx.fillRect(px + offset + TILE_SIZE / 2, py + row * brickH, TILE_SIZE / 2 - 1, brickH - 1);
    // Mortar shadow
    ctx.fillStyle = PALETTE.wallShadow;
    ctx.fillRect(px, py + row * brickH + brickH - 1, TILE_SIZE, 1);
  }
}

// ─── Draw pixel-art avatar ───────────────────────────────────────────────────
function drawAvatar(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  color: string,
  dir: string,
  initials: string,
  name: string,
  isNearby: boolean,
) {
  const W = TILE_SIZE - 6;   // sprite width
  const H = TILE_SIZE - 4;   // sprite height
  const left = centerX - W / 2;
  const top  = centerY - H / 2;

  // Outline / hard shadow
  ctx.fillStyle = PALETTE.avatarOutline;
  ctx.fillRect(left - 2, top - 2, W + 4, H + 4);

  // Body
  ctx.fillStyle = color;
  ctx.fillRect(left, top + 8, W, H - 12);

  // Legs (direction-aware)
  ctx.fillStyle = "#374151";
  if (dir === "down" || dir === "up") {
    ctx.fillRect(left + 2,     top + H - 6, 6, 6);
    ctx.fillRect(left + W - 8, top + H - 6, 6, 6);
  } else {
    // Side-facing — one leg forward
    ctx.fillRect(left + 2, top + H - 8, 6, 8);
    ctx.fillRect(left + W - 8, top + H - 4, 6, 4);
  }

  // Head
  ctx.fillStyle = PALETTE.avatarHead;
  ctx.fillRect(left + 5, top, W - 10, 10);

  // Facial pixel (eyes)
  ctx.fillStyle = "#1e293b";
  if (dir !== "up") {
    ctx.fillRect(left + 7,     top + 3, 2, 2);
    ctx.fillRect(left + W - 9, top + 3, 2, 2);
  } else {
    // Back of head — hair pixels
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(left + 6, top + 1, W - 12, 4);
  }

  // Arms (direction)
  ctx.fillStyle = PALETTE.avatarHead;
  if (dir === "left") {
    ctx.fillRect(left - 4, top + 9, 4, 6);
    ctx.fillRect(left + W, top + 11, 4, 4);
  } else if (dir === "right") {
    ctx.fillRect(left + W, top + 9, 4, 6);
    ctx.fillRect(left - 4, top + 11, 4, 4);
  } else {
    ctx.fillRect(left - 4, top + 9, 4, 6);
    ctx.fillRect(left + W, top + 9, 4, 6);
  }

  // Name badge below
  ctx.fillStyle = isNearby ? "rgba(34,197,94,0.7)" : "rgba(11,15,25,0.75)";
  const badgeW = Math.max(initials.length * 6 + 10, name.slice(0, 8).length * 5 + 8);
  ctx.fillRect(centerX - badgeW / 2, centerY + H / 2 + 3, badgeW, 11);
  ctx.fillStyle = isNearby ? "#fff" : "#9ca3af";
  ctx.font = "bold 7px 'Share Tech Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(name.slice(0, 8).toUpperCase(), centerX, centerY + H / 2 + 4);
}

// ─── Draw zone furniture props ───────────────────────────────────────────────
function drawZoneProps(
  ctx: CanvasRenderingContext2D,
  type: "kitchen" | "cafeteria" | "meeting" | "lounge",
  zone: { x: number; y: number; w: number; h: number },
) {
  const zx = zone.x * TILE_SIZE;
  const zy = zone.y * TILE_SIZE;
  const zw = zone.w * TILE_SIZE;
  const zh = zone.h * TILE_SIZE;

  if (type === "kitchen") {
    // Counter along top
    ctx.fillStyle = PALETTE.counterEdge;
    ctx.fillRect(zx + 4, zy + 4, zw - 8, TILE_SIZE - 8);
    ctx.fillStyle = PALETTE.counterSurface;
    ctx.fillRect(zx + 4, zy + 4, zw - 8, TILE_SIZE - 12);
    // Coffee machine (right side of counter)
    const mx = zx + zw - 28;
    const my = zy + 5;
    ctx.fillStyle = PALETTE.coffeeMachine;
    ctx.fillRect(mx, my, 20, 16);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(mx + 3, my + 3, 8, 8);  // screen
    ctx.fillStyle = PALETTE.coffeeLight;
    ctx.fillRect(mx + 14, my + 3, 3, 3); // light
    // Steam pixels (3 dots above)
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(mx + 7,  my - 3, 2, 2);
    ctx.fillRect(mx + 11, my - 5, 2, 2);
    ctx.fillRect(mx + 15, my - 3, 2, 2);
    // Sink on left
    ctx.fillStyle = "#374151";
    ctx.fillRect(zx + 8, zy + 6, 16, 12);
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(zx + 10, zy + 8, 12, 8);

  } else if (type === "cafeteria") {
    // Two café tables in center
    const midX = zx + zw / 2;
    const midY = zy + zh / 2;
    [[midX - TILE_SIZE * 1.2, midY], [midX + TILE_SIZE * 1.2, midY]].forEach(([tx, ty]) => {
      // Table circle
      ctx.fillStyle = PALETTE.cafeTableEdge;
      ctx.beginPath();
      ctx.arc(tx, ty, TILE_SIZE / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.cafeTable;
      ctx.beginPath();
      ctx.arc(tx, ty, TILE_SIZE / 2 - 5, 0, Math.PI * 2);
      ctx.fill();
      // 4 chair pixels around table
      ctx.fillStyle = "#374151";
      [[-14, 0], [14, 0], [0, -14], [0, 14]].forEach(([dx, dy]) => {
        ctx.fillRect(tx + dx - 3, ty + dy - 3, 6, 6);
      });
    });

  } else if (type === "meeting") {
    // Central conference table
    const pad = TILE_SIZE;
    ctx.fillStyle = PALETTE.meetingTableEdge;
    ctx.fillRect(zx + pad - 2, zy + pad - 2, zw - pad * 2 + 4, zh - pad * 2 + 4);
    ctx.fillStyle = PALETTE.meetingTable;
    ctx.fillRect(zx + pad, zy + pad, zw - pad * 2, zh - pad * 2);
    // Chairs around table (pixel squares)
    ctx.fillStyle = "#334155";
    const tw = zw - pad * 2;
    const th = zh - pad * 2;
    const numH = Math.floor(tw / (TILE_SIZE + 2));
    const numV = Math.floor(th / (TILE_SIZE + 2));
    for (let i = 0; i < numH; i++) {
      const cx = zx + pad + i * (TILE_SIZE + 2) + 4;
      ctx.fillRect(cx, zy + pad - 10, TILE_SIZE - 8, 8);
      ctx.fillRect(cx, zy + pad + th + 2, TILE_SIZE - 8, 8);
    }
    for (let i = 0; i < numV; i++) {
      const cy = zy + pad + i * (TILE_SIZE + 2) + 4;
      ctx.fillRect(zx + pad - 10, cy, 8, TILE_SIZE - 8);
      ctx.fillRect(zx + pad + tw + 2, cy, 8, TILE_SIZE - 8);
    }
    // Whiteboard on far wall
    ctx.fillStyle = PALETTE.whiteboardSurface;
    ctx.fillRect(zx + zw - 8, zy + 8, 6, 24);
    ctx.fillStyle = PALETTE.whiteboardMarker;
    ctx.fillRect(zx + zw - 7, zy + 12, 4, 2);
    ctx.fillRect(zx + zw - 7, zy + 18, 3, 2);

  } else if (type === "lounge") {
    // Sofa — 3-segment along bottom of zone
    const sy = zy + zh - TILE_SIZE - 4;
    const segW = TILE_SIZE + 4;
    // Back
    ctx.fillStyle = PALETTE.sofaBack;
    ctx.fillRect(zx + 6, sy - 6, segW * 3, 6);
    // Seats
    [0, 1, 2].forEach((i) => {
      ctx.fillStyle = PALETTE.sofaBody;
      ctx.fillRect(zx + 6 + i * segW, sy, segW - 2, TILE_SIZE - 6);
      // Cushion highlight
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(zx + 8 + i * segW, sy + 2, segW - 6, 6);
    });
    // Armrests
    ctx.fillStyle = PALETTE.sofaBack;
    ctx.fillRect(zx + 4,             sy - 4, 4, TILE_SIZE - 2);
    ctx.fillRect(zx + 6 + segW * 3,  sy - 4, 4, TILE_SIZE - 2);
    // Potted plant in corner
    const px = zx + zw - 20;
    const py = zy + 8;
    ctx.fillStyle = PALETTE.plantPot;
    ctx.fillRect(px, py + 12, 14, 10);
    ctx.fillRect(px + 2, py + 10, 10, 4);
    ctx.fillStyle = PALETTE.plantLeaf;
    ctx.beginPath();
    ctx.arc(px + 7, py + 5, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#15803d";
    ctx.beginPath();
    ctx.arc(px + 7, py + 3, 5, 0, Math.PI * 2);
    ctx.fill();
  }
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

// ─── ActivityContent ─────────────────────────────────────────────────────────
function ActivityContent() {
  useSearchParams();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const [currentZoneName, setCurrentZoneName] = useState<string | null>(null);

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

  const selfPresence = useMemo(
    () => (user ? presence.get(user.id) : null),
    [user, presence],
  );

  // Update current zone name for HUD display
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

  // Keyboard movement
  useEffect(() => {
    if (!map || !user || !selfPresence) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      let nx = selfPresence.x, ny = selfPresence.y, dir = selfPresence.dir;
      switch (e.key) {
        case "ArrowUp":    case "w": case "W": ny--; dir = "up";    break;
        case "ArrowDown":  case "s": case "S": ny++; dir = "down";  break;
        case "ArrowLeft":  case "a": case "A": nx--; dir = "left";  break;
        case "ArrowRight": case "d": case "D": nx++; dir = "right"; break;
        default: return;
      }
      e.preventDefault();
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) {
        sendMove(selfPresence.x, selfPresence.y, dir); return;
      }
      if (map.blocked.includes(ny * map.width + nx)) {
        sendMove(selfPresence.x, selfPresence.y, dir); return;
      }
      sendMove(nx, ny, dir);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [map, user, selfPresence, sendMove]);

  // Canvas render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width  = map.width  * TILE_SIZE;
    canvas.height = map.height * TILE_SIZE;

    // Background
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Zone helper
    const zoneTypeForTile = (x: number, y: number) => {
      for (const zone of zones) {
        if (x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h)
          return getZoneStyle(zone.name)?.type ?? null;
      }
      return null;
    };

    // ── Floor & walls ────────────────────────────────────────────────────────
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const px = x * TILE_SIZE, py = y * TILE_SIZE;
        if (map.blocked.includes(y * map.width + x)) {
          drawWallTile(ctx, px, py);
          continue;
        }
        const checker = (x + y) % 2 === 0;
        const zt = zoneTypeForTile(x, y);
        if      (zt === "kitchen")   ctx.fillStyle = checker ? PALETTE.kitchenFloorA  : PALETTE.kitchenFloorB;
        else if (zt === "cafeteria") ctx.fillStyle = checker ? PALETTE.cafeteriaFloorA : PALETTE.cafeteriaFloorB;
        else if (zt === "meeting")   ctx.fillStyle = PALETTE.meetingFloor;
        else if (zt === "lounge")    ctx.fillStyle = checker ? PALETTE.loungeFloorA   : PALETTE.loungeFloorB;
        else                         ctx.fillStyle = checker ? PALETTE.corridorFloorDark : PALETTE.corridorFloorLight;
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        // Subtle pixel grid line on every tile
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }

    // ── Zone overlays + furniture ─────────────────────────────────────────────
    zones.forEach((zone) => {
      const isActive =
        selfPresence &&
        selfPresence.x >= zone.x && selfPresence.x < zone.x + zone.w &&
        selfPresence.y >= zone.y && selfPresence.y < zone.y + zone.h;
      const zoneStyle = getZoneStyle(zone.name);

      // Draw furniture first (behind zone border)
      if (zoneStyle?.type) drawZoneProps(ctx, zoneStyle.type, zone);

      // Zone border — retro bracket style
      const stroke = isActive ? PALETTE.zoneStrokeActive : PALETTE.zoneStrokeDefault;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      const bx = zone.x * TILE_SIZE + 1;
      const by = zone.y * TILE_SIZE + 1;
      const bw = zone.w * TILE_SIZE - 2;
      const bh = zone.h * TILE_SIZE - 2;
      const cs = 8; // corner size
      ctx.beginPath();
      // Top-left L
      ctx.moveTo(bx + cs, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by + cs);
      // Top-right L
      ctx.moveTo(bx + bw - cs, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cs);
      // Bottom-left L
      ctx.moveTo(bx, by + bh - cs); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cs, by + bh);
      // Bottom-right L
      ctx.moveTo(bx + bw - cs, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cs);
      ctx.stroke();

      // Zone label
      if (zone.name) {
        const labelColor = isActive ? PALETTE.zoneLabelActive : PALETTE.zoneLabelDefault;
        // Label background pill
        ctx.fillStyle = isActive ? "rgba(250,204,21,0.12)" : "rgba(0,0,0,0.5)";
        const labelW = zone.name.length * 6 + 10;
        ctx.fillRect(bx + 4, by + 4, labelW, 12);
        ctx.fillStyle = labelColor;
        ctx.font = "bold 8px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(zone.name.toUpperCase(), bx + 6, by + 5);
      }
    });

    // ── Avatars ───────────────────────────────────────────────────────────────
    presence.forEach((up) => {
      const isSelf   = user && up.user_id === user.id;
      const isNearby = proximityPeers.includes(up.user_id);
      const cx = up.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = up.y * TILE_SIZE + TILE_SIZE / 2;

      // Proximity ring for self
      if (isSelf && nearbyAvEnabled) {
        ctx.beginPath();
        ctx.arc(cx, cy, 4 * TILE_SIZE, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(99,102,241,0.07)";
        ctx.fill();
        ctx.strokeStyle = "rgba(99,102,241,0.25)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const color = isSelf
        ? PALETTE.avatarSelf
        : isNearby
        ? PALETTE.avatarNearby
        : getAvatarColor(up.user_id);

      const initials = up.display_name
        .split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

      drawAvatar(ctx, cx, cy, color, up.dir ?? "down", initials, up.display_name, isNearby);
    });

  }, [map, zones, presence, user, proximityPeers, selfPresence, nearbyAvEnabled]);

  // Canvas scale
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const base = Math.min(
        rect.width  / (map.width  * TILE_SIZE),
        rect.height / (map.height * TILE_SIZE),
        3,
      );
      setCanvasScale(base > 0 ? base : 1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [map]);

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
      const error = err as Error & { name?: string };
      let msg = "Could not access camera/microphone. ";
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
        msg += "Permission denied — allow in browser settings and reload.";
      else if (error.name === "NotFoundError")
        msg += "No camera/microphone found.";
      else
        msg += error.message || "Unknown error";
      alert(msg);
    }
  }, [setLocalStream, setNearbyAvEnabled]);

  const handleDisableNearbyAV = useCallback(() => {
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    clearPeerConnections();
    setNearbyAvEnabled(false);
  }, [localStream, setLocalStream, clearPeerConnections, setNearbyAvEnabled]);

  return (
    <div className="h-[calc(100vh-60px)] flex" style={{ background: "var(--background)" }}>

      {/* ── Main canvas ── */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        <div ref={containerRef} className="relative w-full h-full max-w-5xl max-h-[720px] flex items-center justify-center">
          <div className="relative">
            <canvas
              ref={canvasRef}
              style={{
                imageRendering: "pixelated",
                transform: `scale(${canvasScale})`,
                transformOrigin: "top left",
                border: "2px solid var(--outline-dim)",
              }}
            />

            {/* Zone name overlay (bottom-left of canvas) */}
            {currentZoneName && (
              <div
                className="absolute bottom-10 left-2 pixel-frame pixel-mono text-xs px-3 py-1 uppercase tracking-widest"
                style={{
                  background: "rgba(250,204,21,0.12)",
                  color: "var(--secondary)",
                  fontSize: "0.65rem",
                  transform: `scale(${1 / canvasScale})`,
                  transformOrigin: "bottom left",
                  border: "1px solid var(--secondary)",
                }}
              >
                ▶ {currentZoneName.toUpperCase()}
              </div>
            )}

            {/* Controls hint */}
            <div
              className="absolute bottom-2 left-2 pixel-mono uppercase tracking-widest"
              style={{
                background: "rgba(11,15,25,0.8)",
                color: "var(--muted)",
                fontSize: "0.6rem",
                padding: "2px 8px",
                transform: `scale(${1 / canvasScale})`,
                transformOrigin: "bottom left",
              }}
            >
              WASD / ↑↓←→ to move
            </div>
          </div>
        </div>
      </div>

      {/* ── A/V HUD Sidebar ── */}
      <div
        className="w-72 flex flex-col"
        style={{
          background: "var(--surface-low)",
          borderLeft: "2px solid var(--outline-dim)",
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-center gap-2"
          style={{ borderBottom: "2px solid var(--outline-dim)" }}
        >
          <span className={nearbyAvEnabled ? "pixel-badge-on" : "pixel-badge-off"} />
          <span className="pixel-mono text-xs font-bold uppercase tracking-widest" style={{ color: "var(--secondary-lit)" }}>
            COMMS_HUD
          </span>
        </div>

        {/* A/V toggle */}
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--outline-dim)" }}>
          {nearbyAvEnabled ? (
            <button
              id="disable-av-btn"
              onClick={handleDisableNearbyAV}
              className="pixel-btn w-full py-2 px-4 pixel-mono text-xs uppercase tracking-widest font-semibold"
              style={{ background: "#7f1d1d", color: "#fca5a5", borderBottom: "4px solid #450a0a" }}
            >
              ■ DISABLE A/V
            </button>
          ) : (
            <button
              id="enable-av-btn"
              onClick={handleEnableNearbyAV}
              className="pixel-btn w-full py-2 px-4 pixel-mono text-xs uppercase tracking-widest font-semibold"
              style={{ background: "var(--primary)", color: "#fff", borderBottom: "4px solid #312e81" }}
            >
              ▶ ENABLE A/V
            </button>
          )}
        </div>

        {/* Local video */}
        {nearbyAvEnabled && localStream && (
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--outline-dim)" }}>
            <p className="pixel-mono text-xs text-[var(--muted)] mb-1 uppercase tracking-widest">
              LOCAL_FEED
            </p>
            <div style={{ border: "1px solid var(--outline-dim)" }}>
              <video
                autoPlay muted playsInline
                ref={(el) => { if (el && localStream) el.srcObject = localStream; }}
                className="w-full aspect-video bg-black object-cover"
                style={{ borderRadius: 0 }}
              />
            </div>
          </div>
        )}

        {/* Status readout */}
        <div
          className="px-4 py-3"
          style={{ background: "var(--surface-lowest, #0a0e18)", borderBottom: "1px solid var(--outline-dim)" }}
        >
          <p className="pixel-mono text-xs text-[var(--muted)] mb-2 uppercase tracking-widest">STATUS_READOUT</p>
          {[
            ["A/V",    nearbyAvEnabled ? "ENABLED"  : "DISABLED",  nearbyAvEnabled ? "#22c55e" : "#facc15"],
            ["CAM",    localStream     ? "ACTIVE"   : "INACTIVE",  localStream     ? "#22c55e" : "#ef4444"],
            ["NEARBY", String(proximityPeers.length), "var(--foreground)"],
            ["CONN",   String(peerConnections.size),  "var(--foreground)"],
          ].map(([label, value, color]) => (
            <div key={label} className="flex justify-between items-center mb-1">
              <span className="pixel-mono text-xs text-[var(--muted)] uppercase tracking-wider">{label}:</span>
              <span className="pixel-mono text-xs font-bold" style={{ color }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Nearby peers */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <p className="pixel-mono text-xs text-[var(--muted)] mb-3 uppercase tracking-widest">
            NEARBY ({proximityPeers.length})
          </p>
          {proximityPeers.length === 0 ? (
            <div className="space-y-1">
              <p className="pixel-mono text-xs text-[var(--outline)]">Move closer to others</p>
              <p className="pixel-mono text-xs text-[var(--outline)]">Proximity: 4 tiles</p>
            </div>
          ) : (
            <div className="space-y-3">
              {proximityPeers.map((peerId) => {
                const peerPresence   = presence.get(peerId);
                const peerConnection = peerConnections.get(peerId);
                const connState      = peerConnection?.pc?.connectionState || "none";
                const badgeColor = connState === "connected" ? "#22c55e" : connState === "connecting" ? "#facc15" : connState === "failed" ? "#ef4444" : "#6b7280";
                return (
                  <div
                    key={peerId}
                    className="space-y-1 p-2"
                    style={{ background: "var(--surface-mid)", border: "1px solid var(--outline-dim)" }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="pixel-mono text-xs uppercase tracking-widest" style={{ color: "var(--secondary-lit)" }}>
                        {(peerPresence?.display_name || "UNKNOWN").slice(0, 10).toUpperCase()}
                      </p>
                      <span className="pixel-mono text-xs px-1.5 py-0.5" style={{ background: `${badgeColor}22`, color: badgeColor }}>
                        {connState.toUpperCase()}
                      </span>
                    </div>
                    {peerConnection?.remoteStream ? (
                      <div style={{ border: "1px solid var(--outline-dim)" }}>
                        <PeerVideo stream={peerConnection.remoteStream} />
                      </div>
                    ) : (
                      <div
                        className="w-full aspect-video flex items-center justify-center flex-col gap-1"
                        style={{ background: "var(--surface-lowest, #0a0e18)" }}
                      >
                        <span className="pixel-mono text-xs text-[var(--outline)] uppercase tracking-wider">
                          {!nearbyAvEnabled ? "ENABLE_AV" : connState === "none" ? "WAITING..." : connState === "connecting" ? "LINKING..." : connState === "failed" ? "CONN_FAIL" : "NO_SIGNAL"}
                        </span>
                        {!nearbyAvEnabled && (
                          <span className="pixel-mono text-xs" style={{ color: "var(--secondary)" }}>
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
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
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
