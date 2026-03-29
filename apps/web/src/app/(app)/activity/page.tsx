"use client";

import {
  useEffect,
  useRef,
  useCallback,
  Suspense,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { useStore } from "@/store";
import { useWebSocketContext } from "@/hooks/WebSocketProvider";

const TILE_SIZE = 64;
const PX = 4; // one "pixel unit" in SVG coordinates (8 cols × 12 rows → 32×48 SVG)

// ─── Palette ─────────────────────────────────────────────────────────────────
const HAIR   = "#3d2b1a";
const SKIN   = "#f5c5a3";
const PANTS  = "#2d3a4a";
const SHOES  = "#1a1f2e";
const DOT    = "#0d0d0d"; // eye/outline

const AVATAR_OUTFITS = [
  "#e05c1a", "#c8186e", "#d4a017",
  "#1ea862", "#0d8fc0", "#7c3aed",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getZoneType(name: string | null | undefined): string | null {
  if (!name) return null;
  const l = name.toLowerCase();
  if (l.includes("kitchen"))                          return "kitchen";
  if (l.includes("cafeteria") || l.includes("cafe")) return "cafeteria";
  if (l.includes("meeting")   || l.includes("room")) return "meeting";
  if (l.includes("lounge")    || l.includes("sofa")) return "lounge";
  return null;
}

function getAvatarColor(id: string | null | undefined) {
  if (!id) return AVATAR_OUTFITS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++)
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_OUTFITS[hash % AVATAR_OUTFITS.length];
}

// ─── Pixel-art sprite grids ───────────────────────────────────────────────────
// Each entry: null = transparent, string = fill colour
// Grid is 8 columns × 12 rows, each cell renders as a PX × PX rect in SVG
function getSpriteGrid(dir: string, color: string): (string | null)[][] {
  const H = HAIR, S = SKIN, C = color, P = PANTS, B = SHOES, D = DOT;
  const _ = null;

  const grids: Record<string, (string | null)[][]> = {
    down: [
      [_, _, H, H, H, H, _, _],
      [_, H, H, H, H, H, H, _],
      [_, S, S, S, S, S, S, _],
      [_, S, D, S, S, D, S, _],
      [_, S, S, S, S, S, S, _],
      [_, _, S, _, _, S, _, _], // neck gap
      [C, C, C, C, C, C, C, C],
      [C, C, C, C, C, C, C, C],
      [C, C, C, C, C, C, C, C],
      [P, P, P, _, _, P, P, P],
      [P, P, P, _, _, P, P, P],
      [B, B, B, _, _, B, B, B],
    ],
    up: [
      [_, _, H, H, H, H, _, _],
      [_, H, H, H, H, H, H, _],
      [H, H, H, H, H, H, H, H],
      [H, H, H, H, H, H, H, H],
      [_, S, S, S, S, S, S, _],
      [_, _, S, S, S, S, _, _],
      [C, C, C, C, C, C, C, C],
      [C, C, C, C, C, C, C, C],
      [C, C, C, C, C, C, C, C],
      [P, P, P, _, _, P, P, P],
      [P, P, P, _, _, P, P, P],
      [B, B, B, _, _, B, B, B],
    ],
    left: [
      [_, H, H, H, H, _, _, _],
      [_, H, H, H, H, H, _, _],
      [_, S, S, S, S, S, _, _],
      [_, D, S, S, S, S, _, _],
      [_, S, S, S, S, _, _, _],
      [_, _, S, S, _, _, _, _],
      [_, C, C, C, C, C, _, _],
      [C, C, C, C, C, C, _, _],
      [_, C, C, C, C, C, _, _],
      [_, P, P, _, P, P, _, _],
      [_, P, P, _, P, P, _, _],
      [_, B, B, _, B, B, _, _],
    ],
    right: [
      [_, _, _, H, H, H, H, _],
      [_, _, H, H, H, H, H, _],
      [_, _, S, S, S, S, S, _],
      [_, _, S, S, S, S, D, _],
      [_, _, _, S, S, S, S, _],
      [_, _, _, _, S, S, _, _],
      [_, _, C, C, C, C, C, _],
      [_, _, C, C, C, C, C, C],
      [_, _, C, C, C, C, C, _],
      [_, _, P, P, _, P, P, _],
      [_, _, P, P, _, P, P, _],
      [_, _, B, B, _, B, B, _],
    ],
  };
  return grids[dir] ?? grids.down;
}

// ─── PeerVideo ────────────────────────────────────────────────────────────────
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

// ─── WallTile ─────────────────────────────────────────────────────────────────
// 3D top-down brick wall: lighter top/left (lit), darker right/bottom (shadow)
function WallTile({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="absolute overflow-hidden"
      style={{
        left:   x * TILE_SIZE,
        top:    y * TILE_SIZE,
        width:  TILE_SIZE,
        height: TILE_SIZE,
        background: "#07090f",
        borderTop:    "4px solid #1a2444",
        borderLeft:   "4px solid #131a33",
        borderRight:  "4px solid #020306",
        borderBottom: "4px solid #020306",
      }}
    >
      {/* Brick rows — alternating mortar offset */}
      {([0, 15, 30, 45] as const).map((topPx, row) => (
        <div key={row} className="absolute w-full" style={{ top: topPx, height: 14 }}>
          {/* mortar line */}
          <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "#010205" }} />
          {/* left brick */}
          <div
            className="absolute"
            style={{
              left:   row % 2 === 0 ? 0 : -20,
              top:    1,
              width:  44,
              height: 12,
              background: "#0c1022",
              borderRight: "2px solid #020306",
            }}
          />
          {/* right brick */}
          <div
            className="absolute"
            style={{
              left:   row % 2 === 0 ? 46 : 26,
              top:    1,
              width:  row % 2 === 0 ? 48 : 44,
              height: 12,
              background: "#0a0e1e",
              borderRight: "2px solid #020306",
            }}
          />
          {/* top-left highlight on each brick */}
          <div
            className="absolute"
            style={{
              left: row % 2 === 0 ? 0 : -20,
              top: 1,
              width: 44,
              height: 2,
              background: "rgba(255,255,255,0.05)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
// SVG pixel-art sprite: 8×12 pixel grid at PX=4 → 32×48 SVG
function Avatar({
  x, y, color, dir, name, isSelf, isNearby,
}: {
  x: number; y: number; color: string; dir: string;
  name: string; isSelf: boolean; isNearby: boolean;
}) {
  const SPRITE_W = 8  * PX; // 32
  const SPRITE_H = 12 * PX; // 48

  // Centre sprite within tile, shift up slightly so feet sit on tile centre
  const left = x * TILE_SIZE + TILE_SIZE / 2 - SPRITE_W / 2;
  const top  = y * TILE_SIZE + TILE_SIZE / 2 - SPRITE_H / 2 - 4;

  const grid = getSpriteGrid(dir, color);

  return (
    <div
      className="absolute transition-all duration-200 ease-linear flex flex-col items-center"
      style={{ left, top, zIndex: 10 + y }}
    >
      {/* Square pixel aura for self — NO border-radius */}
      {isSelf && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: -20, top: -10,
            width: SPRITE_W + 40, height: SPRITE_H + 20,
            border: "2px solid rgba(192, 193, 255, 0.40)",
            boxShadow: "0 0 0 6px rgba(99,102,241,0.08)",
            animation: "pixel-pulse 2s ease-in-out infinite",
          }}
        />
      )}

      {/* SVG pixel-art sprite */}
      <svg
        width={SPRITE_W}
        height={SPRITE_H}
        viewBox={`0 0 ${SPRITE_W} ${SPRITE_H}`}
        style={{ imageRendering: "pixelated", display: "block", overflow: "visible" }}
        aria-hidden
      >
        {grid.flatMap((row, ri) =>
          row.map((fill, ci) =>
            fill ? (
              <rect
                key={`${ri}-${ci}`}
                x={ci * PX}
                y={ri * PX}
                width={PX}
                height={PX}
                fill={fill}
              />
            ) : null
          )
        )}
      </svg>

      {/* Name badge */}
      <div
        style={{
          marginTop: 2,
          padding: "1px 5px",
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: 8,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.10em",
          whiteSpace: "nowrap",
          background: isNearby
            ? "rgba(34,197,94,0.88)"
            : isSelf
            ? "rgba(99,102,241,0.88)"
            : "rgba(10,14,22,0.88)",
          color: isNearby || isSelf ? "#fff" : "#9ca3af",
          border: `1px solid ${isSelf ? "#c0c1ff" : isNearby ? "#22c55e" : "#464554"}`,
          boxShadow: "2px 2px 0 rgba(0,0,0,0.4)",
          zIndex: 40,
        }}
      >
        {name.substring(0, 10)}
      </div>
    </div>
  );
}

// ─── Zone furniture helpers ───────────────────────────────────────────────────

/** Pixel-art rectangular chair — 4 directions */
function Chair({
  top, left, right, dir = "down",
}: {
  top?: number | string;
  left?: number | string;
  right?: number | string;
  dir?: "up" | "down" | "left" | "right";
}) {
  const isH = dir === "left" || dir === "right";
  return (
    <div
      className="absolute"
      style={{
        top, left, right,
        width:  isH ? 12 : 18,
        height: isH ? 18 : 12,
        background: "#374151",
        borderTop:    "2px solid #4b5563",
        borderLeft:   "2px solid #4b5563",
        borderRight:  "2px solid #1f2937",
        borderBottom: "4px solid #1f2937",
      }}
    >
      {/* Seat cushion highlight */}
      <div
        className="absolute"
        style={{
          top: 2, left: 2,
          width: isH ? 5 : 10,
          height: isH ? 10 : 5,
          background: "rgba(255,255,255,0.07)",
        }}
      />
    </div>
  );
}

/** Coffee machine with animated steam */
function CoffeeMachineProp({ style }: { style?: CSSProperties }) {
  return (
    <div className="absolute" style={style}>
      {/* Steam particles */}
      <div className="absolute" style={{ top: -10, left: 5 }}>
        <div
          style={{
            width: 3, height: 8,
            background: "rgba(180,210,255,0.65)",
            animation: "steam 1.8s ease-out infinite",
          }}
        />
      </div>
      <div className="absolute" style={{ top: -8, left: 12 }}>
        <div
          style={{
            width: 2, height: 6,
            background: "rgba(180,210,255,0.45)",
            animation: "steam 1.8s ease-out infinite 0.6s",
          }}
        />
      </div>
      {/* Machine body */}
      <div
        style={{
          width: 22, height: 18,
          background: "#1c2030",
          borderTop:    "2px solid #2a3050",
          borderLeft:   "2px solid #252e48",
          borderRight:  "2px solid #0e1020",
          borderBottom: "4px solid #0a0c18",
        }}
      >
        {/* Display panel */}
        <div
          className="absolute"
          style={{
            top: 2, left: 2, right: 2, height: 6,
            background: "#4f46e5",
            opacity: 0.9,
          }}
        />
        {/* Spout */}
        <div
          className="absolute"
          style={{
            bottom: -4, left: 7, width: 5, height: 4,
            background: "#374151",
          }}
        />
        {/* Button */}
        <div
          className="absolute"
          style={{
            bottom: 2, right: 3, width: 4, height: 4,
            background: "#facc15",
          }}
        />
      </div>
    </div>
  );
}

/** Potted plant (uses circle-like leaf cluster for contrast) */
function PlantProp({ style }: { style?: CSSProperties }) {
  return (
    <div className="absolute" style={style}>
      {/* Pot */}
      <div
        style={{
          position: "absolute", bottom: 0,
          width: 16, height: 12,
          background: "#92400e",
          borderTop:    "2px solid #b45309",
          borderLeft:   "2px solid #a16207",
          borderRight:  "2px solid #451a03",
          borderBottom: "4px solid #3a1502",
          left: 4,
        }}
      />
      {/* Leaves — overlapping squares mimic a "round" blob */}
      <div style={{ position: "absolute", bottom: 10 }}>
        <div style={{
          position: "absolute",
          left: 0, top: 0,
          width: 14, height: 14,
          background: "#166534",
          borderTop: "2px solid #15803d",
          borderLeft: "2px solid #14703a",
          borderRight: "2px solid #0f5128",
          borderBottom: "2px solid #0f5128",
        }} />
        <div style={{
          position: "absolute",
          left: 8, top: -4,
          width: 12, height: 12,
          background: "#15803d",
          borderTop: "2px solid #22c55e",
        }} />
        <div style={{
          position: "absolute",
          left: -4, top: -4,
          width: 12, height: 10,
          background: "#14532d",
          borderTop: "2px solid #166534",
        }} />
        {/* Highlight pixel */}
        <div style={{
          position: "absolute",
          left: 6, top: 2,
          width: 4, height: 4,
          background: "#4ade80",
          opacity: 0.5,
        }} />
      </div>
    </div>
  );
}

/** Wall-mounted whiteboard */
function WhiteboardProp({ style }: { style?: CSSProperties }) {
  return (
    <div className="absolute" style={style}>
      <div
        style={{
          width: 40, height: 28,
          background: "#e8e8f0",
          borderTop:    "2px solid #d0d0e0",
          borderLeft:   "2px solid #d4d4e4",
          borderRight:  "4px solid #a8a8bc",
          borderBottom: "4px solid #a8a8bc",
        }}
      >
        {/* Scribble lines */}
        <div style={{ position:"absolute", top: 5,  left: 4, right: 12, height: 2, background: "#6366f1", opacity: 0.7 }} />
        <div style={{ position:"absolute", top: 10, left: 4, right: 6,  height: 2, background: "#374151", opacity: 0.5 }} />
        <div style={{ position:"absolute", top: 15, left: 4, right: 16, height: 2, background: "#6366f1", opacity: 0.4 }} />
        <div style={{ position:"absolute", top: 20, left: 4, right: 8,  height: 2, background: "#374151", opacity: 0.35 }} />
      </div>
      {/* Tray at bottom */}
      <div style={{
        position: "absolute", bottom: -4, left: 0, right: 0, height: 4,
        background: "#c0c0d0",
        borderBottom: "2px solid #909098",
      }} />
    </div>
  );
}

// ─── ZoneOverlay ─────────────────────────────────────────────────────────────
function ZoneOverlay({
  zone, type, isActive,
}: {
  zone: { x: number; y: number; w: number; h: number; name: string | null };
  type: string;
  isActive: boolean;
  activeUsersCount: number;
}) {
  const zLeft   = zone.x * TILE_SIZE;
  const zTop    = zone.y * TILE_SIZE;
  const zWidth  = zone.w * TILE_SIZE;
  const zHeight = zone.h * TILE_SIZE;

  type ZoneCfg = {
    floorA: string; floorB: string;
    border: string;
    labelBg: string; labelColor: string;
    content: ReactNode;
  };

  const configs: Record<string, ZoneCfg> = {
    kitchen: {
      floorA: "#3b2f2a", floorB: "#4b3a30",
      border: "#5c4033",
      labelBg: "#5c3a28", labelColor: "#e8c5a0",
      content: (
        <>
          {/* Counter top strip */}
          <div
            className="absolute top-0 left-0 right-0"
            style={{
              height: 22,
              background: "#5c4033",
              borderBottom: "4px solid #2d1e16",
              borderTop: "2px solid #7a5a4a",
            }}
          />
          {/* Coffee machine */}
          <CoffeeMachineProp style={{ top: 0, right: 20 }} />
          {/* Sink */}
          <div
            className="absolute"
            style={{
              top: 2, left: 20,
              width: 24, height: 18,
              background: "#1a2835",
              borderTop:    "2px solid #243345",
              borderLeft:   "2px solid #1f2e3e",
              borderRight:  "2px solid #0c1720",
              borderBottom: "4px solid #0c1720",
            }}
          >
            <div className="absolute inset-1" style={{ background: "#0e1c2a" }} />
            {/* Faucet */}
            <div className="absolute" style={{ top: 0, left: 9, width: 3, height: 7, background: "#4b5563" }} />
          </div>
          {/* Plant in corner */}
          <PlantProp style={{ bottom: 8, left: 8 }} />
        </>
      ),
    },

    meeting: {
      floorA: "#101827", floorB: "#182035",
      border: "#1f2e42",
      labelBg: "#1a2a40", labelColor: "#a8c4e0",
      content: (
        <>
          {/* Conference table */}
          <div
            className="absolute"
            style={{
              top:    "22%",
              left:   "12%",
              width:  "76%",
              height: "56%",
              background: "#1f2937",
              borderTop:    "4px solid #2d3f52",
              borderLeft:   "4px solid #263445",
              borderRight:  "4px solid #111827",
              borderBottom: "4px solid #111827",
              boxShadow: "4px 4px 0 rgba(0,0,0,0.5)",
            }}
          >
            {/* Surface grain */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)",
                backgroundSize: "16px 100%",
              }}
            />
          </div>
          {/* Chairs — top row */}
          <Chair top="8%"  left="16%" dir="up" />
          <Chair top="8%"  left="44%" dir="up" />
          <Chair top="8%"  left="70%" dir="up" />
          {/* Chairs — bottom row */}
          <Chair top="72%" left="16%" dir="down" />
          <Chair top="72%" left="44%" dir="down" />
          <Chair top="72%" left="70%" dir="down" />
          {/* Whiteboard on left wall */}
          <WhiteboardProp style={{ top: "30%", left: 4 }} />
        </>
      ),
    },

    cafeteria: {
      floorA: "#123641", floorB: "#0f2a34",
      border: "#1a4a55",
      labelBg: "#0f3342", labelColor: "#7dd3e8",
      content: (
        <>
          {/* Table 1 */}
          <div
            className="absolute"
            style={{
              top: "15%", left: "10%",
              width: 56, height: 56,
              background: "#1a3a45",
              borderTop:    "4px solid #2a5a6a",
              borderLeft:   "4px solid #1f4a58",
              borderRight:  "4px solid #0f2530",
              borderBottom: "4px solid #0f2530",
              boxShadow: "4px 4px 0 rgba(0,0,0,0.4)",
            }}
          >
            {/* Cups on table */}
            <div className="absolute" style={{ top: 12, left: 10, width: 10, height: 10, background: "#fff", opacity: 0.75, borderBottom: "2px solid rgba(0,0,0,0.3)" }} />
            <div className="absolute" style={{ top: 12, right: 10, width: 10, height: 10, background: "#facc15", opacity: 0.8, borderBottom: "2px solid rgba(0,0,0,0.3)" }} />
          </div>
          {/* Chairs around table 1 */}
          <Chair top="5%"  left="18%" dir="up" />
          <Chair top="52%" left="18%" dir="down" />
          <Chair top="26%" left="5%"  dir="left" />

          {/* Table 2 */}
          <div
            className="absolute"
            style={{
              top: "15%", right: "10%",
              width: 56, height: 56,
              background: "#1a3a45",
              borderTop:    "4px solid #2a5a6a",
              borderLeft:   "4px solid #1f4a58",
              borderRight:  "4px solid #0f2530",
              borderBottom: "4px solid #0f2530",
              boxShadow: "4px 4px 0 rgba(0,0,0,0.4)",
            }}
          />
          {/* Chairs around table 2 */}
          <Chair top="5%"  right="18%" dir="up" />
          <Chair top="52%" right="18%" dir="down" />
          <Chair top="26%" right="5%"  dir="right" />

          {/* Potted plant corner */}
          <PlantProp style={{ bottom: 8, right: 8 }} />
        </>
      ),
    },

    lounge: {
      floorA: "#22172b", floorB: "#2d1f3a",
      border: "#3a2650",
      labelBg: "#2d1b42", labelColor: "#c4a8e8",
      content: (
        <>
          {/* Rug */}
          <div
            className="absolute"
            style={{
              top: "18%", left: "8%",
              width: "84%", height: "64%",
              background: "#3b1f5c",
              border: "4px solid #2d1650",
            }}
          >
            <div
              className="absolute"
              style={{
                inset: 6,
                border: "2px solid rgba(192,193,255,0.12)",
              }}
            />
          </div>
          {/* Sofa — Left segment */}
          <div
            className="absolute"
            style={{
              bottom: "10%", left: "8%",
              width: 42, height: 34,
              background: "#7c3aed",
              borderTop:    "4px solid #8b5cf6",
              borderLeft:   "4px solid #7c3aed",
              borderRight:  "2px solid #5b21b6",
              borderBottom: "4px solid #3b0764",
              boxShadow: "4px 4px 0 rgba(0,0,0,0.45)",
            }}
          >
            <div className="absolute" style={{ top: 6, left: 4, right: 4, bottom: 6, background: "#8b5cf6" }} />
          </div>
          {/* Sofa — Middle */}
          <div
            className="absolute"
            style={{
              bottom: "10%", left: "calc(8% + 42px)",
              width: 42, height: 34,
              background: "#7c3aed",
              borderTop:    "4px solid #8b5cf6",
              borderBottom: "4px solid #3b0764",
              borderRight:  "2px solid #5b21b6",
            }}
          >
            <div className="absolute" style={{ top: 6, left: 4, right: 4, bottom: 6, background: "#8b5cf6" }} />
          </div>
          {/* Sofa — Right segment */}
          <div
            className="absolute"
            style={{
              bottom: "10%", left: "calc(8% + 84px)",
              width: 42, height: 34,
              background: "#7c3aed",
              borderTop:    "4px solid #8b5cf6",
              borderRight:  "4px solid #7c3aed",
              borderLeft:   "2px solid #5b21b6",
              borderBottom: "4px solid #3b0764",
              boxShadow: "4px 4px 0 rgba(0,0,0,0.45)",
            }}
          >
            <div className="absolute" style={{ top: 6, left: 4, right: 4, bottom: 6, background: "#8b5cf6" }} />
          </div>
          {/* Coffee table */}
          <div
            className="absolute"
            style={{
              bottom: "44%", left: "14%",
              width: 100, height: 26,
              background: "#1f1430",
              borderTop:    "4px solid #2d1f40",
              borderLeft:   "4px solid #261938",
              borderRight:  "4px solid #0d0918",
              borderBottom: "4px solid #0d0918",
              boxShadow: "4px 4px 0 rgba(0,0,0,0.4)",
            }}
          >
            {/* Laptop */}
            <div className="absolute" style={{ top: 4, left: 8, width: 20, height: 12, background: "#6366f1", opacity: 0.55, borderBottom: "2px solid #312e81" }} />
            {/* Mug */}
            <div className="absolute" style={{ top: 4, right: 8, width: 10, height: 10, background: "#78350f", borderBottom: "2px solid #451a03" }} />
          </div>
          {/* Plant in far corner */}
          <PlantProp style={{ top: 8, right: 8 }} />
        </>
      ),
    },
  };

  const cfg: ZoneCfg = configs[type] ?? {
    floorA: "#111827", floorB: "#1a2233",
    border: "#464554",
    labelBg: "#1c2030", labelColor: "#9ca3af",
    content: null,
  };

  const borderColor = isActive ? "#facc15" : cfg.border;

  return (
    <div
      className="absolute overflow-hidden pointer-events-none"
      style={{
        left:   zLeft,
        top:    zTop,
        width:  zWidth,
        height: zHeight,
        backgroundColor: cfg.floorB,
        // Checkerboard floor pattern sized to TILE_SIZE
        backgroundImage: `
          linear-gradient(45deg, ${cfg.floorA} 25%, transparent 25%),
          linear-gradient(-45deg, ${cfg.floorA} 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, ${cfg.floorA} 75%),
          linear-gradient(-45deg, transparent 75%, ${cfg.floorA} 75%)
        `,
        backgroundSize: `${TILE_SIZE}px ${TILE_SIZE}px`,
        backgroundPosition: `0 0, 0 ${TILE_SIZE / 2}px, ${TILE_SIZE / 2}px -${TILE_SIZE / 2}px, -${TILE_SIZE / 2}px 0`,
        border: `4px solid ${borderColor}`,
        boxShadow: "4px 4px 0 rgba(0,0,0,0.5)",
        transition: "border-color 0.25s",
        zIndex: 0,
      }}
    >
      {/* Zone label — top-left corner badge */}
      <div
        className="absolute pixel-mono text-[9px] font-bold tracking-[0.15em] uppercase"
        style={{
          top: 6, left: 8,
          padding: "2px 6px",
          background: isActive ? "#facc15" : cfg.labelBg,
          color:      isActive ? "#1a0a00" : cfg.labelColor,
          boxShadow:  "2px 2px 0 rgba(0,0,0,0.45)",
          zIndex: 20,
        }}
      >
        {zone.name ?? "ZONE"}
      </div>

      {cfg.content}
    </div>
  );
}

// ─── ActivityContent ─────────────────────────────────────────────────────────
function ActivityContent() {
  useSearchParams();
  const [currentZoneName, setCurrentZoneName] = useState<string | null>(null);
  const [commsExpanded, setCommsExpanded] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const user               = useStore((s) => s.user);
  const map                = useStore((s) => s.map);
  const zones              = useStore((s) => s.zones);
  const presence           = useStore((s) => s.presence);
  const proximityPeers     = useStore((s) => s.proximityPeers);
  const nearbyAvEnabled    = useStore((s) => s.nearbyAvEnabled);
  const setNearbyAvEnabled = useStore((s) => s.setNearbyAvEnabled);
  const localStream        = useStore((s) => s.localStream);
  const setLocalStream     = useStore((s) => s.setLocalStream);
  const peerConnections    = useStore((s) => s.peerConnections);
  const clearPeerConnections = useStore((s) => s.clearPeerConnections);
  const setAvScope         = useStore((s) => s.setAvScope);
  const { sendMove, sendMessage } = useWebSocketContext();

  // Auto-focus for keyboard
  useEffect(() => { containerRef.current?.focus(); }, [map]);

  const selfPresence = useMemo(
    () => (user ? presence.get(user.id) : null),
    [user, presence]
  );

  // Zone detection
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
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        t.isContentEditable
      ) return;

      const cur = useStore.getState().presence.get(user.id);
      if (!cur) return;

      let nx = cur.x, ny = cur.y, dir = cur.dir;
      switch (e.key) {
        case "ArrowUp":  case "w": case "W": ny--; dir = "up";    break;
        case "ArrowDown":case "s": case "S": ny++; dir = "down";  break;
        case "ArrowLeft":case "a": case "A": nx--; dir = "left";  break;
        case "ArrowRight":case "d":case "D": nx++; dir = "right"; break;
        default: return;
      }
      e.preventDefault();
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) {
        sendMove(cur.x, cur.y, dir); return;
      }
      if (map.blocked.includes(ny * map.width + nx)) {
        sendMove(cur.x, cur.y, dir); return;
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
      setAvScope("proximity");
      sendMessage("client.av.scope", { scope: "proximity" });
    } catch {
      alert("Could not access camera/microphone.");
    }
  }, [setLocalStream, setNearbyAvEnabled, setAvScope, sendMessage]);

  const handleDisableNearbyAV = useCallback(() => {
    sendMessage("client.av.scope", { scope: "proximity" });
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    clearPeerConnections();
    setNearbyAvEnabled(false);
    setAvScope("proximity");
  }, [sendMessage, localStream, setLocalStream, clearPeerConnections, setNearbyAvEnabled, setAvScope]);

  // Loading state
  if (!map) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[var(--background)] px-4 py-8">
        <p className="pixel-mono text-sm text-[var(--secondary)] animate-pulse tracking-widest uppercase mb-6">
          INIT_WORLD_STATE...
        </p>
        <button
          onClick={() => (window.location.href = "/")}
          className="pixel-btn px-6 py-2 pixel-mono text-xs uppercase font-bold"
          style={{ background: "#7f1d1d", color: "#fca5a5", borderBottom: "4px solid #450a0a" }}
        >
          ABORT &amp; RETURN
        </button>
      </div>
    );
  }

  // Camera: keep self centred
  const camX = selfPresence
    ? selfPresence.x * TILE_SIZE + TILE_SIZE / 2
    : (map.width  * TILE_SIZE) / 2;
  const camY = selfPresence
    ? selfPresence.y * TILE_SIZE + TILE_SIZE / 2
    : (map.height * TILE_SIZE) / 2;

  const wallCoords: { x: number; y: number }[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      if (map.blocked.includes(y * map.width + x))
        wallCoords.push({ x, y });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative h-full min-h-0 w-full flex-1 outline-none"
      style={{ background: "var(--background)" }}
    >
      {/* ── Full-bleed map viewport ── */}
      <div className="absolute inset-0 overflow-hidden" style={{ isolation: "isolate" }}>

        {/* CRT scanline overlay */}
        <div
          className="absolute inset-0 pointer-events-none z-50 opacity-[0.18]"
          style={{
            background: "linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.12) 50%)",
            backgroundSize: "100% 4px",
          }}
        />

        {/* World map — DOM tile grid */}
        <div
          className="absolute transition-transform duration-200 ease-linear"
          style={{
            width:  map.width  * TILE_SIZE,
            height: map.height * TILE_SIZE,
            left:   "315px",
            top:    "215px",
            transform: `translate(-${camX}px, -${camY}px)`,
            // Corridor floor: subtle alternating tile colours via CSS gradient
            backgroundColor: "#0e1420",
            backgroundImage: `
              linear-gradient(45deg, #121a28 25%, transparent 25%),
              linear-gradient(-45deg, #121a28 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #121a28 75%),
              linear-gradient(-45deg, transparent 75%, #121a28 75%),
              linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)
            `,
            backgroundSize: `
              ${TILE_SIZE}px ${TILE_SIZE}px,
              ${TILE_SIZE}px ${TILE_SIZE}px,
              ${TILE_SIZE}px ${TILE_SIZE}px,
              ${TILE_SIZE}px ${TILE_SIZE}px,
              ${TILE_SIZE}px ${TILE_SIZE}px,
              ${TILE_SIZE}px ${TILE_SIZE}px
            `,
            backgroundPosition: `
              0 0,
              0 ${TILE_SIZE / 2}px,
              ${TILE_SIZE / 2}px -${TILE_SIZE / 2}px,
              -${TILE_SIZE / 2}px 0,
              0 0,
              0 0
            `,
          }}
        >
          {/* 1. Zone overlays (floor + furniture) */}
          {zones.map((zone) => {
            const zType = getZoneType(zone.name);
            if (!zType) return null;
            const isActive = !!(
              selfPresence &&
              selfPresence.x >= zone.x && selfPresence.x < zone.x + zone.w &&
              selfPresence.y >= zone.y && selfPresence.y < zone.y + zone.h
            );
            return (
              <ZoneOverlay
                key={zone.zone_id}
                zone={zone}
                type={zType}
                isActive={isActive}
                activeUsersCount={
                  Array.from(presence.values()).filter(
                    (p) => p.zone_id === zone.zone_id
                  ).length
                }
              />
            );
          })}

          {/* 2. Wall tiles */}
          {wallCoords.map(({ x, y }) => (
            <WallTile key={`${x},${y}`} x={x} y={y} />
          ))}

          {/* 3. Avatars (y-sorted depth) */}
          {Array.from(presence.values()).map((p) => {
            const isSelf   = !!user && p.user_id === user.id;
            const isNearby = proximityPeers.includes(p.user_id);
            const color    = isSelf
              ? "var(--primary)"
              : isNearby
              ? "#22c55e"
              : getAvatarColor(p.user_id);
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

        {/* ── Viewport HUD ── */}
        {currentZoneName && (
          <div
            className="absolute bottom-10 left-6 px-4 py-2 pixel-frame pixel-mono text-xs uppercase tracking-widest z-50"
            style={{
              background:  "rgba(250,204,21,0.15)",
              border:      "2px solid #facc15",
              color:       "#facc15",
              boxShadow:   "4px 4px 0 rgba(0,0,0,0.4)",
            }}
          >
            ▶ IN_ZONE: {currentZoneName}
          </div>
        )}

        <div
          className="absolute bottom-4 left-6 px-3 py-1.5 pixel-mono text-[10px] uppercase tracking-widest z-50 pointer-events-none"
          style={{
            background: "rgba(12,16,26,0.85)",
            color:      "var(--muted)",
            border:     "1px solid var(--outline-dim)",
            boxShadow:  "2px 2px 0 rgba(0,0,0,0.3)",
          }}
        >
          WASD / ↑↓←→ TO MOVE
        </div>
      </div>

      {/* ── COMMS panel (floating overlay, right side) ── */}
      <div
        className="absolute top-0 right-0 bottom-0 z-40 flex h-full min-h-0 flex-col transition-[width] duration-200 ease-out"
        style={{
          width:      commsExpanded ? "18rem" : "2.75rem",
          background: "var(--surface-low)",
          borderLeft: "2px solid var(--outline-dim)",
          boxShadow:  "-6px 0 20px rgba(0,0,0,0.50)",
        }}
      >
        {!commsExpanded ? (
          <button
            type="button"
            onClick={() => setCommsExpanded(true)}
            className="flex h-full w-full flex-col items-center justify-center gap-3 px-1 pixel-mono text-[9px] font-bold uppercase tracking-widest hover:bg-[var(--surface-mid)]"
            style={{ writingMode: "vertical-rl", color: "var(--secondary-lit)" }}
            aria-label="Open comms panel"
          >
            COMMS ▶
          </button>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Panel header */}
            <div
              className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
              style={{ borderBottom: "2px solid var(--outline-dim)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={nearbyAvEnabled ? "pixel-badge-on" : "pixel-badge-off"} />
                <span
                  className="pixel-mono text-xs font-bold uppercase tracking-widest truncate"
                  style={{ color: "var(--secondary-lit)" }}
                >
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

            {/* A/V toggle */}
            <div className="px-4 py-3" style={{ borderBottom: "2px solid var(--outline-dim)" }}>
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

            {/* Local feed */}
            {nearbyAvEnabled && localStream && (
              <div className="px-4 py-3" style={{ borderBottom: "2px solid var(--outline-dim)" }}>
                <p className="pixel-mono text-[10px] text-[var(--muted)] mb-1 uppercase tracking-widest">
                  LOCAL_FEED
                </p>
                <div style={{ border: "2px solid var(--outline-dim)", boxShadow: "2px 2px 0 rgba(0,0,0,0.4)" }}>
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
              style={{ background: "var(--surface-lowest, #0a0e18)", borderBottom: "2px solid var(--outline-dim)" }}
            >
              <p className="pixel-mono text-[10px] text-[var(--muted)] mb-2 uppercase tracking-widest">
                STATUS_READOUT
              </p>
              {([
                ["A/V",    nearbyAvEnabled ? "ENABLED"  : "DISABLED",  nearbyAvEnabled ? "#22c55e" : "#facc15"],
                ["CAM",    localStream     ? "ACTIVE"   : "INACTIVE",  localStream     ? "#22c55e" : "#ef4444"],
                ["NEARBY", String(proximityPeers.length),               "var(--foreground)"],
                ["CONN",   String(peerConnections.size),                "var(--foreground)"],
              ] as [string, string, string][]).map(([label, value, color]) => (
                <div key={label} className="flex justify-between items-center mb-1">
                  <span className="pixel-mono text-[10px] text-[var(--muted)] uppercase tracking-wider">{label}:</span>
                  <span className="pixel-mono text-[10px] font-bold" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>

            {/* Nearby peers list */}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 bg-[var(--surface-low)]">
              <p className="pixel-mono text-[10px] text-[var(--muted)] mb-3 uppercase tracking-widest">
                NEARBY ({proximityPeers.length})
              </p>
              {proximityPeers.length === 0 ? (
                <div className="space-y-1">
                  <p className="pixel-mono text-[10px] text-[var(--outline)]">Move closer to others</p>
                  <p className="pixel-mono text-[10px] text-[var(--outline)]">Proximity: 4 tiles</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {proximityPeers.map((peerId) => {
                    const peerPresence  = presence.get(peerId);
                    const peerConn      = peerConnections.get(peerId);
                    const connState     = peerConn?.pc?.connectionState || "none";
                    const badgeColor    =
                      connState === "connected"  ? "#22c55e" :
                      connState === "connecting" ? "#facc15" :
                      connState === "failed"     ? "#ef4444" :
                      "#6b7280";
                    return (
                      <div
                        key={peerId}
                        className="space-y-1 p-2"
                        style={{
                          background: "var(--surface-mid)",
                          border:     "2px solid var(--outline-dim)",
                          boxShadow:  "2px 2px 0 rgba(0,0,0,0.3)",
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <p
                            className="pixel-mono text-[10px] uppercase tracking-widest"
                            style={{ color: "var(--secondary-lit)" }}
                          >
                            {(peerPresence?.display_name || "UNKNOWN").slice(0, 10).toUpperCase()}
                          </p>
                          <span
                            className="pixel-mono text-[9px] px-1.5 py-0.5"
                            style={{ background: `${badgeColor}22`, color: badgeColor }}
                          >
                            {connState.toUpperCase()}
                          </span>
                        </div>
                        {peerConn?.remoteStream ? (
                          <div style={{ border: "2px solid var(--outline-dim)" }}>
                            <PeerVideo stream={peerConn.remoteStream} />
                          </div>
                        ) : (
                          <div
                            className="w-full aspect-video flex items-center justify-center flex-col gap-1"
                            style={{ background: "var(--surface-lowest, #0a0e18)" }}
                          >
                            <span className="pixel-mono text-[10px] text-[var(--outline)] uppercase tracking-wider">
                              {!nearbyAvEnabled  ? "ENABLE_AV"  :
                               connState === "none"       ? "WAITING..."  :
                               connState === "connecting" ? "LINKING..."  :
                               connState === "failed"     ? "CONN_FAIL"   :
                               "NO_SIGNAL"}
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
