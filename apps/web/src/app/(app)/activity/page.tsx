'use client';

import { useEffect, useRef, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStore } from '@/store';
import { useWebSocket } from '@/hooks/useWebSocket';

const TILE_SIZE = 32;

function ActivityContent() {
  const searchParams = useSearchParams();
  const spaceId = searchParams.get('space');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Use individual selectors to prevent unnecessary re-renders
  const user = useStore((state) => state.user);
  const map = useStore((state) => state.map);
  const zones = useStore((state) => state.zones);
  const presence = useStore((state) => state.presence);
  const proximityPeers = useStore((state) => state.proximityPeers);
  const nearbyAvEnabled = useStore((state) => state.nearbyAvEnabled);
  const setNearbyAvEnabled = useStore((state) => state.setNearbyAvEnabled);
  const localStream = useStore((state) => state.localStream);
  const setLocalStream = useStore((state) => state.setLocalStream);
  const peerConnections = useStore((state) => state.peerConnections);
  const clearPeerConnections = useStore((state) => state.clearPeerConnections);

  const { sendMove } = useWebSocket(spaceId);

  // Get current user's presence - memoized to prevent recalculation
  const selfPresence = useMemo(() => {
    return user ? presence.get(user.id) : null;
  }, [user, presence]);

  // Handle keyboard movement
  useEffect(() => {
    if (!map || !user || !selfPresence) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent handling if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      let newX = selfPresence.x;
      let newY = selfPresence.y;
      let dir = selfPresence.dir;

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          newY = selfPresence.y - 1;
          dir = 'up';
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          newY = selfPresence.y + 1;
          dir = 'down';
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          newX = selfPresence.x - 1;
          dir = 'left';
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          newX = selfPresence.x + 1;
          dir = 'right';
          break;
        default:
          return;
      }

      e.preventDefault();

      // Validate bounds
      if (newX < 0 || newX >= map.width || newY < 0 || newY >= map.height) {
        return;
      }

      // Check blocked tiles
      const tileIndex = newY * map.width + newX;
      if (map.blocked.includes(tileIndex)) {
        return;
      }

      sendMove(newX, newY, dir);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [map, user, selfPresence, sendMove]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = map.width * TILE_SIZE;
    canvas.height = map.height * TILE_SIZE;

    // Clear canvas
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw tiles
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tileIndex = y * map.width + x;
        const isBlocked = map.blocked.includes(tileIndex);

        ctx.fillStyle = isBlocked ? '#333' : '#2a2a2a';
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1);
      }
    }

    // Draw zones
    zones.forEach((zone) => {
      const isUserInZone = selfPresence && 
        selfPresence.x >= zone.x && 
        selfPresence.x < zone.x + zone.w &&
        selfPresence.y >= zone.y && 
        selfPresence.y < zone.y + zone.h;

      ctx.strokeStyle = isUserInZone ? '#22c55e' : '#4b5563';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(
        zone.x * TILE_SIZE + 2,
        zone.y * TILE_SIZE + 2,
        zone.w * TILE_SIZE - 4,
        zone.h * TILE_SIZE - 4,
        8
      );
      ctx.stroke();

      // Zone label
      if (zone.name) {
        ctx.fillStyle = isUserInZone ? '#22c55e' : '#6b7280';
        ctx.font = '10px sans-serif';
        ctx.fillText(zone.name, zone.x * TILE_SIZE + 6, zone.y * TILE_SIZE + 14);
      }
    });

    // Draw users
    presence.forEach((userPresence) => {
      const isSelf = user && userPresence.user_id === user.id;
      const isNearby = proximityPeers.includes(userPresence.user_id);

      const centerX = userPresence.x * TILE_SIZE + TILE_SIZE / 2;
      const centerY = userPresence.y * TILE_SIZE + TILE_SIZE / 2;

      // Draw proximity range indicator for self
      if (isSelf && nearbyAvEnabled) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, 4 * TILE_SIZE, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw avatar circle
      ctx.beginPath();
      ctx.arc(centerX, centerY, TILE_SIZE / 2 - 2, 0, Math.PI * 2);
      
      if (isSelf) {
        ctx.fillStyle = '#6366f1';
      } else if (isNearby) {
        ctx.fillStyle = '#22c55e';
      } else {
        ctx.fillStyle = '#4b5563';
      }
      ctx.fill();

      // Draw initials
      const initials = userPresence.display_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, centerX, centerY);

      // Draw name below
      ctx.fillStyle = isSelf ? '#6366f1' : '#9ca3af';
      ctx.font = '9px sans-serif';
      ctx.fillText(
        userPresence.display_name.slice(0, 10),
        centerX,
        centerY + TILE_SIZE / 2 + 8
      );
    });
  }, [map, zones, presence, user, proximityPeers, selfPresence, nearbyAvEnabled]);

  const handleEnableNearbyAV = useCallback(async () => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support camera/microphone access. Please use a modern browser like Chrome or Firefox.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setLocalStream(stream);
      setNearbyAvEnabled(true);
    } catch (err: unknown) {
      console.error('Error accessing media devices:', err);
      
      const error = err as Error & { name?: string };
      let message = 'Could not access camera/microphone. ';
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        message += 'Permission was denied. Please allow camera/microphone access in your browser settings and reload the page.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        message += 'No camera or microphone found. Please connect a camera/microphone and try again.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        message += 'Camera/microphone is already in use by another application.';
      } else if (error.name === 'OverconstrainedError') {
        message += 'Could not satisfy media constraints.';
      } else if (error.name === 'TypeError') {
        message += 'Invalid media constraints.';
      } else {
        message += `Error: ${error.message || 'Unknown error'}`;
      }
      
      alert(message);
    }
  }, [setLocalStream, setNearbyAvEnabled]);

  const handleDisableNearbyAV = useCallback(() => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    clearPeerConnections();
    setNearbyAvEnabled(false);
  }, [localStream, setLocalStream, clearPeerConnections, setNearbyAvEnabled]);

  return (
    <div className="h-[calc(100vh-60px)] flex">
      {/* Main canvas area */}
      <div className="flex-1 flex items-center justify-center bg-[var(--background)] overflow-auto p-4">
        <div className="relative">
          <canvas
            ref={canvasRef}
            className="rounded-lg border border-[var(--border)]"
            style={{ imageRendering: 'pixelated' }}
          />
          <div className="absolute bottom-4 left-4 text-xs text-[var(--muted)] bg-[var(--card)] px-2 py-1 rounded">
            Use Arrow keys or WASD to move
          </div>
        </div>
      </div>

      {/* Right sidebar for nearby A/V */}
      <div className="w-80 bg-[var(--card)] border-l border-[var(--border)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold mb-3">Nearby A/V</h2>
          {nearbyAvEnabled ? (
            <button
              onClick={handleDisableNearbyAV}
              className="w-full py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors"
            >
              Disable Nearby A/V
            </button>
          ) : (
            <button
              onClick={handleEnableNearbyAV}
              className="w-full py-2 px-4 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-medium transition-colors"
            >
              Enable Nearby A/V
            </button>
          )}
        </div>

        {/* Local video preview */}
        {nearbyAvEnabled && localStream && (
          <div className="p-4 border-b border-[var(--border)]">
            <p className="text-xs text-[var(--muted)] mb-2">You</p>
            <video
              autoPlay
              muted
              playsInline
              ref={(el) => {
                if (el && localStream) {
                  el.srcObject = localStream;
                }
              }}
              className="w-full aspect-video rounded-lg bg-black object-cover"
            />
          </div>
        )}

        {/* Nearby peers */}
        <div className="flex-1 overflow-auto p-4">
          <p className="text-xs text-[var(--muted)] mb-2">
            Nearby ({proximityPeers.length})
          </p>
          {proximityPeers.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Move closer to others to connect
            </p>
          ) : (
            <div className="space-y-3">
              {proximityPeers.map((peerId) => {
                const peerPresence = presence.get(peerId);
                const peerConnection = peerConnections.get(peerId);
                return (
                  <div key={peerId} className="space-y-1">
                    <p className="text-xs text-[var(--muted)]">
                      {peerPresence?.display_name || 'Unknown'}
                    </p>
                    {peerConnection?.remoteStream ? (
                      <video
                        autoPlay
                        playsInline
                        ref={(el) => {
                          if (el && peerConnection.remoteStream) {
                            el.srcObject = peerConnection.remoteStream;
                          }
                        }}
                        className="w-full aspect-video rounded-lg bg-black object-cover"
                      />
                    ) : (
                      <div className="w-full aspect-video rounded-lg bg-[var(--background)] flex items-center justify-center">
                        <span className="text-xs text-[var(--muted)]">
                          {nearbyAvEnabled ? 'Connecting...' : 'Enable A/V'}
                        </span>
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
    <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
      <ActivityContent />
    </Suspense>
  );
}
