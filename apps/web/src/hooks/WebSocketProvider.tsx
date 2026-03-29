'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { useStore, canonicalUserId } from '@/store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';

/** Build ws/wss origin from http(s) API base (replace('http','ws') breaks https:// → must use URL). */
function apiBaseToWsOrigin(apiBase: string): string {
  try {
    const u = new URL(apiBase);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.origin;
  } catch {
    return apiBase.replace(/^http/, 'ws');
  }
}

const WS_BASE = apiBaseToWsOrigin(API_BASE);

interface WsMessage {
  type: string;
  payload: unknown;
}

interface JoinedPayload {
  self: { user_id: string; display_name: string };
  space: { space_id: string; name: string };
  map: {
    map_id: string;
    width: number;
    height: number;
    tiles: number[];
    blocked: number[];
  } | null;
  zones: Array<{
    zone_id: string;
    name: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  presence: Array<{
    user_id: string;
    display_name: string;
    x: number;
    y: number;
    dir: string;
    zone_id: string | null;
  }>;
  /** user_id -> "proximity" | "space" */
  av_scopes?: Record<string, string>;
}

/** Max concurrent mesh peers in Meetings (full-space) mode — mesh cost is O(n²). */
const MAX_SPACE_MESH_PEERS = 15;

interface PresenceUpdatePayload {
  user_id: string;
  display_name?: string;
  x: number;
  y: number;
  dir: string;
  zone_id: string | null;
}

interface PresenceLeavePayload {
  user_id: string;
}

interface ProximityPayload {
  peers: string[];
}

interface ChatNewPayload {
  id: string;
  channel: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
}

interface WebRTCSignalPayload {
  from_user_id: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

interface WebSocketContextValue {
  sendMove: (x: number, y: number, dir: string) => void;
  sendChat: (channel: string, body: string) => boolean;
  sendMessage: (type: string, payload: unknown) => boolean;
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
}

interface WebSocketProviderProps {
  children: ReactNode;
  spaceId: string | null;
}

export function WebSocketProvider({ children, spaceId }: WebSocketProviderProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false);
  /** Bumps when we need to retry after an abnormal close (effect deps). */
  const [wsReconnectTick, setWsReconnectTick] = useState(0);
  /** Queue ICE candidates until remote description is set (required for connection in many browsers) */
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  /** Offers received while A/V was disabled; process when user enables A/V */
  const pendingOffersRef = useRef<Map<string, { sdp: string }>>(new Map());
  /** Peer IDs for which createPeerConnection has been called but not yet settled — prevents duplicate PCs */
  const inFlightPeersRef = useRef<Set<string>>(new Set());

  // Get stable references to store functions
  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const setSpace = useStore((state) => state.setSpace);
  const setMap = useStore((state) => state.setMap);
  const setPresence = useStore((state) => state.setPresence);
  const updatePresence = useStore((state) => state.updatePresence);
  const removePresence = useStore((state) => state.removePresence);
  const setProximityPeers = useStore((state) => state.setProximityPeers);
  const proximityPeers = useStore((state) => state.proximityPeers);
  const avScope = useStore((state) => state.avScope);
  const peerAvScopes = useStore((state) => state.peerAvScopes);
  const presence = useStore((state) => state.presence);
  const setPeerAvScopesFromJoined = useStore((state) => state.setPeerAvScopesFromJoined);
  const patchPeerAvScope = useStore((state) => state.patchPeerAvScope);
  const addChatMessage = useStore((state) => state.addChatMessage);
  const setWs = useStore((state) => state.setWs);
  const setWsConnected = useStore((state) => state.setWsConnected);
  const wsConnected = useStore((state) => state.wsConnected);
  const nearbyAvEnabled = useStore((state) => state.nearbyAvEnabled);
  const localStream = useStore((state) => state.localStream);
  const setPeerConnection = useStore((state) => state.setPeerConnection);
  const updatePeerStream = useStore((state) => state.updatePeerStream);
  const removePeerConnection = useStore((state) => state.removePeerConnection);
  const clearPeerConnections = useStore((state) => state.clearPeerConnections);

  // Use refs to access current values in callbacks without causing re-renders
  const userRef = useRef(user);
  const nearbyAvEnabledRef = useRef(nearbyAvEnabled);
  const localStreamRef = useRef(localStream);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    nearbyAvEnabledRef.current = nearbyAvEnabled;
  }, [nearbyAvEnabled]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const getWs = useCallback(() => wsRef.current ?? useStore.getState().ws ?? null, []);

  const drainIceQueue = useCallback((peerId: string) => {
    const id = canonicalUserId(peerId);
    const queue = pendingIceRef.current.get(id);
    if (!queue?.length) return;
    const peerConn = useStore.getState().peerConnections.get(id);
    if (!peerConn?.pc?.remoteDescription) return;
    const pc = peerConn.pc;
    pendingIceRef.current.delete(id);
    queue.forEach((candidate) => {
      pc.addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => console.log('[WebRTC] Added queued ICE candidate for', id))
        .catch((err) => console.error('[WebRTC] Error adding queued ICE candidate:', err));
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean): RTCPeerConnection | null => {
      peerId = canonicalUserId(peerId);
      const currentUser = userRef.current;
      const currentLocalStream = localStreamRef.current;

      // Guard: already in-flight or already connected — prevents duplicate PCs from rapid proximity events
      if (inFlightPeersRef.current.has(peerId)) {
        console.log('[WebRTC] Skipping duplicate createPeerConnection for', peerId, '(already in-flight)');
        return null;
      }
      if (useStore.getState().peerConnections.has(peerId)) {
        console.log('[WebRTC] Skipping createPeerConnection for', peerId, '(already exists)');
        return null;
      }
      inFlightPeersRef.current.add(peerId);

      if (!currentUser || !currentLocalStream) {
        console.log('[WebRTC] Cannot create peer connection - missing user or stream', {
          hasUser: !!currentUser,
          hasStream: !!currentLocalStream
        });
        inFlightPeersRef.current.delete(peerId);
        return null;
      }

      console.log('[WebRTC] Creating peer connection to', peerId, 'isInitiator:', isInitiator);

      // Use both STUN and TURN servers for better connectivity
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          // Free public TURN server (for testing - consider using your own for production)
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
          },
        ],
        iceCandidatePoolSize: 10,
      });

      // Log connection state changes
      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state with', peerId, ':', pc.connectionState);
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[WebRTC] ICE connection state with', peerId, ':', pc.iceConnectionState);
      };

      // Add local tracks
      currentLocalStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentLocalStream);
      });

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('[WebRTC] ICE candidate generated for', peerId, event.candidate.type);
          const ws = getWs();
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'client.webrtc.ice',
                payload: {
                  to_user_id: peerId,
                  candidate: event.candidate.toJSON(),
                },
              })
            );
          } else {
            console.log('[WebRTC] Cannot send ICE candidate - WebSocket not ready');
          }
        } else {
          console.log('[WebRTC] ICE gathering complete for', peerId);
        }
      };

      // Handle remote tracks (can fire once per track; merge into one stream per peer)
      pc.ontrack = (event) => {
        console.log('[WebRTC] Received track from', peerId, event.track.kind);
        const existing = useStore.getState().peerConnections.get(peerId)?.remoteStream;
        let stream: MediaStream;
        if (event.streams && event.streams[0]) {
          stream = event.streams[0];
          if (existing && !existing.getTracks().includes(event.track)) {
            existing.addTrack(event.track);
            stream = existing;
          }
        } else {
          if (existing && !existing.getTracks().includes(event.track)) {
            existing.addTrack(event.track);
            stream = existing;
          } else {
            stream = new MediaStream([event.track]);
          }
        }
        console.log('[WebRTC] Got remote stream from', peerId, 'tracks:', stream.getTracks().length);
        updatePeerStream(peerId, stream);
      };

      setPeerConnection(peerId, pc, null);
      // Connection is now tracked in the store — safe to remove from in-flight set
      inFlightPeersRef.current.delete(peerId);

      // If initiator, create offer; capture sdp before the async gap to avoid stale closure
      if (isInitiator) {
        console.log('[WebRTC] Creating offer for', peerId);
        pc.createOffer()
          .then((offer) => {
            console.log('[WebRTC] Offer created for', peerId);
            return pc.setLocalDescription(offer).then(() => offer);
          })
          .then((offer) => {
            console.log('[WebRTC] Local description set for', peerId);
            const ws = getWs();
            // Use the offer SDP we captured — avoids reading pc.localDescription after async gap
            if (offer.sdp && ws?.readyState === WebSocket.OPEN) {
              console.log('[WebRTC] Sending offer to', peerId);
              ws.send(
                JSON.stringify({
                  type: 'client.webrtc.offer',
                  payload: { to_user_id: peerId, sdp: offer.sdp },
                })
              );
            } else {
              console.log('[WebRTC] Cannot send offer - WebSocket not ready');
            }
          })
          .catch((err) => {
            console.error('[WebRTC] Error creating offer:', err);
            inFlightPeersRef.current.delete(peerId);
          });
      }

      return pc;
    },
    [setPeerConnection, updatePeerStream, getWs]
  );

  /** Apply remote SDP offer: create PC if needed, answer, send — shared by WS handler and pending-offer drain. */
  const applyRemoteOffer = useCallback(
    (rawPeerId: string, sdp: string) => {
      const fromId = canonicalUserId(rawPeerId);
      const peerConnections = useStore.getState().peerConnections;
      const existing = peerConnections.get(fromId);
      if (existing?.pc?.remoteDescription) {
        console.log('[WebRTC] Skip offer; remote description already set for', fromId);
        return Promise.resolve();
      }

      let pc: RTCPeerConnection;
      if (!existing) {
        const newPc = createPeerConnection(fromId, false);
        if (!newPc) return Promise.reject(new Error('Cannot create peer connection'));
        pc = newPc;
      } else {
        pc = existing.pc;
      }

      return pc
        .setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer).then(() => answer))
        .then((answer) => {
          // Use captured answer SDP — avoids stale pc.localDescription read after async gap
          const ws = getWs();
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'client.webrtc.answer',
                payload: { to_user_id: fromId, sdp: answer.sdp },
              })
            );
          }
          drainIceQueue(fromId);
        });
    },
    [createPeerConnection, getWs, drainIceQueue]
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: WsMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'server.joined': {
            const payload = message.payload as JoinedPayload;
            setSpace(payload.space.space_id, payload.space.name);
            setMap(
              payload.map
                ? {
                    map_id: payload.map.map_id,
                    width: payload.map.width,
                    height: payload.map.height,
                    tiles: payload.map.tiles,
                    blocked: payload.map.blocked,
                  }
                : null,
              payload.zones
            );
            const selfId = canonicalUserId(payload.self.user_id);
            const presenceRows = payload.presence.map((p) => ({
              user_id: p.user_id,
              display_name: p.display_name,
              x: p.x,
              y: p.y,
              dir: p.dir as 'up' | 'down' | 'left' | 'right',
              zone_id: p.zone_id,
            }));
            if (!presenceRows.some((p) => canonicalUserId(p.user_id) === selfId)) {
              presenceRows.push({
                user_id: selfId,
                display_name: payload.self.display_name,
                x: 5,
                y: 5,
                dir: 'down',
                zone_id: null,
              });
            }
            setPresence(presenceRows);
            if (payload.av_scopes && typeof payload.av_scopes === 'object') {
              setPeerAvScopesFromJoined(payload.av_scopes);
            }
            break;
          }
          case 'server.presence.update': {
            const payload = message.payload as PresenceUpdatePayload;
            const dn =
              typeof payload.display_name === 'string' && payload.display_name.trim().length > 0
                ? payload.display_name.trim()
                : undefined;
            updatePresence({
              user_id: canonicalUserId(payload.user_id),
              x: payload.x,
              y: payload.y,
              dir: payload.dir as 'up' | 'down' | 'left' | 'right',
              zone_id: payload.zone_id,
              ...(dn !== undefined ? { display_name: dn } : {}),
            });
            break;
          }
          case 'server.presence.leave': {
            const payload = message.payload as PresenceLeavePayload;
            removePresence(canonicalUserId(payload.user_id));
            break;
          }
          case 'server.presence.snapshot': {
            const payload = message.payload as { presence: Array<{ user_id: string; display_name: string; x: number; y: number; dir: string; zone_id: string | null }> };
            if (Array.isArray(payload.presence)) {
              setPresence(
                payload.presence.map((p) => ({
                  user_id: p.user_id,
                  display_name: p.display_name,
                  x: p.x,
                  y: p.y,
                  dir: p.dir as 'up' | 'down' | 'left' | 'right',
                  zone_id: p.zone_id,
                }))
              );
            }
            break;
          }
          case 'server.move.rejected': {
            const payload = message.payload as { reason?: string };
            console.warn('[Move] Rejected by server:', payload.reason ?? 'unknown');
            break;
          }
          case 'server.proximity': {
            const payload = message.payload as ProximityPayload;
            setProximityPeers(payload.peers);
            break;
          }
          case 'server.av.scope_changed': {
            const payload = message.payload as { user_id?: string; scope?: string };
            if (
              payload.user_id &&
              (payload.scope === 'space' || payload.scope === 'proximity')
            ) {
              patchPeerAvScope(canonicalUserId(payload.user_id), payload.scope);
            }
            break;
          }
          case 'server.chat.new': {
            const payload = message.payload as ChatNewPayload;
            addChatMessage({
              id: payload.id,
              channel: payload.channel,
              user_id: payload.user_id,
              display_name: payload.display_name,
              body: payload.body,
              created_at: payload.created_at,
            });
            break;
          }
          case 'server.webrtc.offer': {
            const payload = message.payload as WebRTCSignalPayload;
            const currentUser = userRef.current;
            const currentNearbyAvEnabled = nearbyAvEnabledRef.current;
            const currentLocalStream = localStreamRef.current;
            const fromId = canonicalUserId(payload.from_user_id);

            console.log('[WebRTC] Received offer from', fromId, {
              avEnabled: currentNearbyAvEnabled,
              hasStream: !!currentLocalStream
            });

            if (!payload.sdp) return;

            if (!currentUser || !currentNearbyAvEnabled || !currentLocalStream) {
              console.log('[WebRTC] Storing offer – will process when A/V is enabled');
              pendingOffersRef.current.set(fromId, { sdp: payload.sdp });
              return;
            }

            applyRemoteOffer(fromId, payload.sdp).catch((err) =>
              console.error('Error handling offer:', err)
            );
            break;
          }
          case 'server.webrtc.answer': {
            const payload = message.payload as WebRTCSignalPayload;
            const fromId = canonicalUserId(payload.from_user_id);
            console.log('[WebRTC] Received answer from', fromId);
            if (!payload.sdp) return;

            const peerConnections = useStore.getState().peerConnections;
            const peerConn = peerConnections.get(fromId);
            if (!peerConn) {
              console.log('[WebRTC] No peer connection found for answer from', fromId);
              return;
            }

            peerConn.pc
              .setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }))
              .then(() => {
                console.log('[WebRTC] Set remote description (answer) for', fromId);
                drainIceQueue(fromId);
              })
              .catch((err) => console.error('Error handling answer:', err));
            break;
          }
          case 'server.webrtc.ice': {
            const payload = message.payload as WebRTCSignalPayload;
            const fromId = canonicalUserId(payload.from_user_id);
            console.log('[WebRTC] Received ICE candidate from', fromId);
            if (!payload.candidate) return;

            const peerConnections = useStore.getState().peerConnections;
            const peerConn = peerConnections.get(fromId);
            if (!peerConn) {
              console.log('[WebRTC] No peer connection found for ICE from', fromId);
              return;
            }

            const pc = peerConn.pc;
            if (!pc.remoteDescription) {
              const queue = pendingIceRef.current.get(fromId) ?? [];
              queue.push(payload.candidate);
              pendingIceRef.current.set(fromId, queue);
              console.log('[WebRTC] Queued ICE candidate for', fromId, '(no remote description yet)');
              return;
            }
            pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
              .then(() => console.log('[WebRTC] Added ICE candidate for', fromId))
              .catch((err) => console.error('Error adding ICE candidate:', err));
            break;
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    },
    [
      setSpace,
      setMap,
      setPresence,
      setPeerAvScopesFromJoined,
      updatePresence,
      removePresence,
      setProximityPeers,
      patchPeerAvScope,
      addChatMessage,
      applyRemoteOffer,
      removePeerConnection,
      getWs,
      drainIceQueue,
    ]
  );

  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  /**
   * Single place for WebRTC peer set: Activity uses server `proximityPeers`;
   * Meetings uses everyone in `peerAvScopes` with `space` (capped).
   */
  useEffect(() => {
    const state = useStore.getState();
    const {
      user: currentUser,
      nearbyAvEnabled: enabled,
      localStream: stream,
      peerConnections: conns,
      avScope: mode,
      peerAvScopes: scopes,
      proximityPeers: proxPeers,
      presence: pres,
    } = state;
    if (!currentUser || !enabled || !stream) return;

    let desiredList: string[];
    if (mode === 'space') {
      desiredList = Array.from(pres.keys())
        .filter((id) => id !== currentUser.id && scopes[id] === 'space')
        .sort()
        .slice(0, MAX_SPACE_MESH_PEERS);
    } else {
      desiredList = [...proxPeers];
    }

    const desiredPeers = new Set(desiredList);
    const currentPeers = new Set(conns.keys());

    console.log('[WebRTC] Sync peers', {
      mode,
      desired: desiredList,
      current: Array.from(currentPeers),
    });

    // Process offers from peers who connected before we enabled A/V first — must run BEFORE
    // creating placeholder peer connections; otherwise we hit `conns.has` and dropped the SDP.
    const offersCopy = new Map(pendingOffersRef.current);
    pendingOffersRef.current.clear();
    offersCopy.forEach(({ sdp }, rawFromId) => {
      const fromId = canonicalUserId(rawFromId);
      if (!desiredPeers.has(fromId)) {
        pendingOffersRef.current.set(fromId, { sdp });
        return;
      }
      applyRemoteOffer(fromId, sdp).catch((err) =>
        console.error('[WebRTC] Error processing pending offer:', err)
      );
    });

    desiredPeers.forEach((peerId) => {
      // createPeerConnection itself guards against duplicates via inFlightPeersRef + store check
      const isInitiator = currentUser.id < peerId;
      createPeerConnection(peerId, isInitiator);
    });

    Array.from(useStore.getState().peerConnections.keys()).forEach((peerId) => {
      if (!desiredPeers.has(peerId)) {
        pendingIceRef.current.delete(peerId);
        pendingOffersRef.current.delete(peerId);
        inFlightPeersRef.current.delete(peerId);
        removePeerConnection(peerId);
      }
    });
  }, [
    nearbyAvEnabled,
    localStream,
    user?.id,
    avScope,
    peerAvScopes,
    proximityPeers,
    presence,
    createPeerConnection,
    applyRemoteOffer,
    removePeerConnection,
  ]);

  // Main connection effect (token + spaceId + wsReconnectTick; message handler via ref)
  useEffect(() => {
    if (!token || !spaceId) {
      console.log('[WebSocket] Missing token or spaceId, not connecting');
      return;
    }

    if (isConnectingRef.current) {
      console.log('[WebSocket] Connection attempt already in progress');
      return;
    }

    let cancelled = false;

    console.log('[WebSocket] Starting new connection to space:', spaceId);
    isConnectingRef.current = true;

    const wsUrl = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&space_id=${spaceId}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      if (cancelled) return;
      console.log('[WebSocket] Connected successfully');
      isConnectingRef.current = false;
      setWsConnected(true);
      setWs(socket);
    };

    socket.onmessage = (event: MessageEvent) => {
      handleMessageRef.current(event);
    };

    socket.onclose = (event) => {
      console.log('[WebSocket] Closed with code:', event.code, 'reason:', event.reason);
      isConnectingRef.current = false;
      setWsConnected(false);
      setWs(null);
      
      // Only clear ref if this is still the current socket
      if (wsRef.current === socket) {
        wsRef.current = null;
      }

      // Clean up peer connections on disconnect
      pendingIceRef.current.clear();
      pendingOffersRef.current.clear();
      inFlightPeersRef.current.clear();
      clearPeerConnections();

      // Abnormal close (e.g. 1006): schedule reconnect by bumping tick so this effect re-runs
      if (!cancelled && event.code !== 1000 && event.code !== 1001) {
        console.log('[WebSocket] Unexpected close, scheduling reconnect in 2s');
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!cancelled && wsRef.current === null) {
            setWsReconnectTick((t) => t + 1);
          }
        }, 2000);
      }
    };

    socket.onerror = () => {
      if (cancelled) return;
      isConnectingRef.current = false;
      console.warn(
        '[WebSocket] Connection error. Check NEXT_PUBLIC_API_BASE matches your API (HTTPS sites need https:// so WebSocket uses wss://), and that the server is reachable.'
      );
    };

    return () => {
      cancelled = true;
      console.log('[WebSocket] Cleanup triggered');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Only close if this socket is still current
      if (wsRef.current === socket) {
        console.log('[WebSocket] Closing socket');
        socket.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
      isConnectingRef.current = false;
      pendingIceRef.current.clear();
      pendingOffersRef.current.clear();
      inFlightPeersRef.current.clear();
      clearPeerConnections();
    };
  }, [token, spaceId, wsReconnectTick, setWs, setWsConnected, clearPeerConnections]);

  // Get WebSocket from store for sending messages (more reliable than ref during remounts)
  const storeWs = useStore((state) => state.ws);
  
  const sendMessage = useCallback((type: string, payload: unknown) => {
    // Prefer store WebSocket over ref for reliability during component lifecycle changes
    const ws = storeWs || wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }, [storeWs]);

  const sendMove = useCallback(
    (x: number, y: number, dir: string) => {
      sendMessage('client.move', { x, y, dir });
    },
    [sendMessage]
  );

  const sendChat = useCallback(
    (channel: string, body: string): boolean => {
      const sent = sendMessage('client.chat.send', { channel, body });
      if (!sent) {
        console.error('Failed to send chat message - WebSocket not connected');
      }
      return sent;
    },
    [sendMessage]
  );

  const contextValue: WebSocketContextValue = {
    sendMove,
    sendChat,
    sendMessage,
    isConnected: wsConnected,
  };

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}
