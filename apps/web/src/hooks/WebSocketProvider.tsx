'use client';

import { createContext, useContext, useCallback, useEffect, useRef, ReactNode, useMemo } from 'react';
import { useStore } from '@/store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';
const WS_BASE = API_BASE.replace('http', 'ws');

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
}

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
  /** Queue ICE candidates until remote description is set (required for connection in many browsers) */
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  /** Offers received while A/V was disabled; process when user enables A/V */
  const pendingOffersRef = useRef<Map<string, { sdp: string }>>(new Map());

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
    const queue = pendingIceRef.current.get(peerId);
    if (!queue?.length) return;
    const peerConn = useStore.getState().peerConnections.get(peerId);
    if (!peerConn?.pc?.remoteDescription) return;
    const pc = peerConn.pc;
    pendingIceRef.current.delete(peerId);
    queue.forEach((candidate) => {
      pc.addIceCandidate(new RTCIceCandidate(candidate))
        .then(() => console.log('[WebRTC] Added queued ICE candidate for', peerId))
        .catch((err) => console.error('[WebRTC] Error adding queued ICE candidate:', err));
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean): RTCPeerConnection | null => {
      const currentUser = userRef.current;
      const currentLocalStream = localStreamRef.current;
      
      if (!currentUser || !currentLocalStream) {
        console.log('[WebRTC] Cannot create peer connection - missing user or stream', {
          hasUser: !!currentUser,
          hasStream: !!currentLocalStream
        });
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

      // If initiator, create offer
      if (isInitiator) {
        console.log('[WebRTC] Creating offer for', peerId);
        pc.createOffer()
          .then((offer) => {
            console.log('[WebRTC] Offer created for', peerId);
            return pc.setLocalDescription(offer);
          })
          .then(() => {
            console.log('[WebRTC] Local description set for', peerId);
            const ws = getWs();
            if (pc.localDescription && ws?.readyState === WebSocket.OPEN) {
              console.log('[WebRTC] Sending offer to', peerId);
              ws.send(
                JSON.stringify({
                  type: 'client.webrtc.offer',
                  payload: {
                    to_user_id: peerId,
                    sdp: pc.localDescription.sdp,
                  },
                })
              );
            } else {
              console.log('[WebRTC] Cannot send offer - WebSocket not ready');
            }
          })
          .catch((err) => console.error('[WebRTC] Error creating offer:', err));
      }

      return pc;
    },
    [setPeerConnection, updatePeerStream, getWs]
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
            break;
          }
          case 'server.presence.update': {
            const payload = message.payload as PresenceUpdatePayload;
            updatePresence({
              user_id: payload.user_id,
              display_name: payload.display_name || '',
              x: payload.x,
              y: payload.y,
              dir: payload.dir as 'up' | 'down' | 'left' | 'right',
              zone_id: payload.zone_id,
            });
            break;
          }
          case 'server.presence.leave': {
            const payload = message.payload as PresenceLeavePayload;
            removePresence(payload.user_id);
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
          case 'server.proximity': {
            const payload = message.payload as ProximityPayload;
            const currentUser = userRef.current;
            const currentNearbyAvEnabled = nearbyAvEnabledRef.current;
            const currentLocalStream = localStreamRef.current;

            console.log('[Proximity] Update received:', {
              peers: payload.peers,
              avEnabled: currentNearbyAvEnabled,
              hasStream: !!currentLocalStream
            });

            // Always update proximity peers list
            setProximityPeers(payload.peers);

            // Only manage WebRTC connections if A/V is enabled
            if (currentUser && currentNearbyAvEnabled && currentLocalStream) {
              const desiredPeers = new Set(payload.peers);
              const currentPeers = new Set(useStore.getState().peerConnections.keys());

              console.log('[Proximity] Managing WebRTC connections:', {
                desiredPeers: Array.from(desiredPeers),
                currentPeers: Array.from(currentPeers)
              });

              // Connect to new peers
              desiredPeers.forEach((peerId) => {
                if (!currentPeers.has(peerId)) {
                  const isInitiator = currentUser.id < peerId;
                  createPeerConnection(peerId, isInitiator);
                }
              });

              // Disconnect from peers no longer in range
              currentPeers.forEach((peerId) => {
                if (!desiredPeers.has(peerId)) {
                  pendingIceRef.current.delete(peerId);
                  pendingOffersRef.current.delete(peerId);
                  removePeerConnection(peerId);
                }
              });
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

            console.log('[WebRTC] Received offer from', payload.from_user_id, {
              avEnabled: currentNearbyAvEnabled,
              hasStream: !!currentLocalStream
            });

            if (!payload.sdp) return;

            if (!currentUser || !currentNearbyAvEnabled || !currentLocalStream) {
              console.log('[WebRTC] Storing offer – will process when A/V is enabled');
              pendingOffersRef.current.set(payload.from_user_id, { sdp: payload.sdp });
              return;
            }

            const peerConnections = useStore.getState().peerConnections;
            let peerConn = peerConnections.get(payload.from_user_id);
            let pc: RTCPeerConnection;

            if (!peerConn) {
              const newPc = createPeerConnection(payload.from_user_id, false);
              if (!newPc) return;
              pc = newPc;
            } else {
              pc = peerConn.pc;
            }

            pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }))
              .then(() => pc.createAnswer())
              .then((answer) => pc.setLocalDescription(answer))
              .then(() => {
                const ws = getWs();
                if (ws?.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: 'client.webrtc.answer',
                      payload: {
                        to_user_id: payload.from_user_id,
                        sdp: pc.localDescription?.sdp,
                      },
                    })
                  );
                }
                drainIceQueue(payload.from_user_id);
              })
              .catch((err) => console.error('Error handling offer:', err));
            break;
          }
          case 'server.webrtc.answer': {
            const payload = message.payload as WebRTCSignalPayload;
            console.log('[WebRTC] Received answer from', payload.from_user_id);
            if (!payload.sdp) return;

            const peerConnections = useStore.getState().peerConnections;
            const peerConn = peerConnections.get(payload.from_user_id);
            if (!peerConn) {
              console.log('[WebRTC] No peer connection found for answer from', payload.from_user_id);
              return;
            }

            peerConn.pc
              .setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }))
              .then(() => {
                console.log('[WebRTC] Set remote description (answer) for', payload.from_user_id);
                drainIceQueue(payload.from_user_id);
              })
              .catch((err) => console.error('Error handling answer:', err));
            break;
          }
          case 'server.webrtc.ice': {
            const payload = message.payload as WebRTCSignalPayload;
            console.log('[WebRTC] Received ICE candidate from', payload.from_user_id);
            if (!payload.candidate) return;

            const peerConnections = useStore.getState().peerConnections;
            const peerConn = peerConnections.get(payload.from_user_id);
            if (!peerConn) {
              console.log('[WebRTC] No peer connection found for ICE from', payload.from_user_id);
              return;
            }

            const pc = peerConn.pc;
            if (!pc.remoteDescription) {
              const queue = pendingIceRef.current.get(payload.from_user_id) ?? [];
              queue.push(payload.candidate);
              pendingIceRef.current.set(payload.from_user_id, queue);
              console.log('[WebRTC] Queued ICE candidate for', payload.from_user_id, '(no remote description yet)');
              return;
            }
            pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
              .then(() => console.log('[WebRTC] Added ICE candidate for', payload.from_user_id))
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
      updatePresence,
      removePresence,
      setProximityPeers,
      addChatMessage,
      createPeerConnection,
      removePeerConnection,
      getWs,
      drainIceQueue,
    ]
  );

  // When user enables A/V: create peer connections for proximity peers and process any offers we received while A/V was off
  useEffect(() => {
    const state = useStore.getState();
    const { user: currentUser, nearbyAvEnabled: enabled, localStream: stream, peerConnections: conns } = state;
    if (!currentUser || !enabled || !stream) return;

    const currentPeers = new Set(conns.keys());
    const desiredPeers = new Set(proximityPeers);

    desiredPeers.forEach((peerId) => {
      if (!currentPeers.has(peerId)) {
        const isInitiator = currentUser.id < peerId;
        console.log('[Proximity] A/V just enabled – creating peer connection to', peerId);
        createPeerConnection(peerId, isInitiator);
      }
    });

    currentPeers.forEach((peerId) => {
      if (!desiredPeers.has(peerId)) {
        pendingIceRef.current.delete(peerId);
        pendingOffersRef.current.delete(peerId);
        removePeerConnection(peerId);
      }
    });

    // Process offers that arrived while A/V was disabled
    const offersCopy = new Map(pendingOffersRef.current);
    pendingOffersRef.current.clear();
    offersCopy.forEach(({ sdp }, fromUserId) => {
      const connsNow = useStore.getState().peerConnections;
      if (connsNow.has(fromUserId)) return;
      const pc = createPeerConnection(fromUserId, false);
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => {
          const ws = getWs();
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'client.webrtc.answer',
                payload: { to_user_id: fromUserId, sdp: pc.localDescription?.sdp },
              })
            );
          }
          drainIceQueue(fromUserId);
        })
        .catch((err) => console.error('[WebRTC] Error processing pending offer:', err));
    });
  }, [nearbyAvEnabled, localStream, proximityPeers, createPeerConnection, removePeerConnection, getWs, drainIceQueue]);

  // Main connection effect
  useEffect(() => {
    if (!token || !spaceId) {
      console.log('[WebSocket] Missing token or spaceId, not connecting');
      return;
    }
    
    // Check if already connected or connecting
    const existingWs = wsRef.current;
    if (existingWs) {
      const state = existingWs.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        console.log('[WebSocket] Already connected/connecting, skipping');
        return;
      }
    }
    
    if (isConnectingRef.current) {
      console.log('[WebSocket] Connection attempt already in progress');
      return;
    }

    console.log('[WebSocket] Starting new connection to space:', spaceId);
    isConnectingRef.current = true;

    const wsUrl = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&space_id=${spaceId}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('[WebSocket] Connected successfully');
      isConnectingRef.current = false;
      setWsConnected(true);
      setWs(socket);
    };

    socket.onmessage = handleMessage;

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
      clearPeerConnections();

      // Only attempt reconnect for unexpected closures
      if (event.code !== 1000 && event.code !== 1001) {
        console.log('[WebSocket] Unexpected close, will attempt reconnect');
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          if (wsRef.current === null) {
            isConnectingRef.current = false;
            // The effect will re-run and create a new connection
          }
        }, 2000);
      }
    };

    socket.onerror = (event) => {
      console.error('[WebSocket] Error:', event);
      isConnectingRef.current = false;
    };

    return () => {
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
      clearPeerConnections();
    };
  }, [token, spaceId, handleMessage, setWs, setWsConnected, clearPeerConnections]);

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
