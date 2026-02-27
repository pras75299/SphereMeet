'use client';

import { useCallback, useEffect, useRef } from 'react';
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

export function useWebSocket(spaceId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false);

  // Get stable references to store functions (they don't change)
  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const setSpace = useStore((state) => state.setSpace);
  const setMap = useStore((state) => state.setMap);
  const setPresence = useStore((state) => state.setPresence);
  const updatePresence = useStore((state) => state.updatePresence);
  const removePresence = useStore((state) => state.removePresence);
  const setProximityPeers = useStore((state) => state.setProximityPeers);
  const addChatMessage = useStore((state) => state.addChatMessage);
  const setWs = useStore((state) => state.setWs);
  const setWsConnected = useStore((state) => state.setWsConnected);
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

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean): RTCPeerConnection | null => {
      const currentUser = userRef.current;
      const currentLocalStream = localStreamRef.current;
      
      if (!currentUser || !currentLocalStream) return null;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Add local tracks
      currentLocalStream.getTracks().forEach((track) => {
        pc.addTrack(track, currentLocalStream);
      });

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'client.webrtc.ice',
              payload: {
                to_user_id: peerId,
                candidate: event.candidate.toJSON(),
              },
            })
          );
        }
      };

      // Handle remote tracks
      pc.ontrack = (event) => {
        const remoteStream = event.streams[0];
        if (remoteStream) {
          updatePeerStream(peerId, remoteStream);
        }
      };

      setPeerConnection(peerId, pc, null);

      // If initiator, create offer
      if (isInitiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (pc.localDescription && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'client.webrtc.offer',
                  payload: {
                    to_user_id: peerId,
                    sdp: pc.localDescription.sdp,
                  },
                })
              );
            }
          })
          .catch((err) => console.error('Error creating offer:', err));
      }

      return pc;
    },
    [setPeerConnection, updatePeerStream]
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
          case 'server.proximity': {
            const payload = message.payload as ProximityPayload;
            const currentUser = userRef.current;
            const currentNearbyAvEnabled = nearbyAvEnabledRef.current;
            const currentLocalStream = localStreamRef.current;

            // Always update proximity peers list
            setProximityPeers(payload.peers);

            // Only manage WebRTC connections if A/V is enabled
            if (currentUser && currentNearbyAvEnabled && currentLocalStream) {
              const desiredPeers = new Set(payload.peers);
              const currentPeers = new Set(useStore.getState().peerConnections.keys());

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

            if (!currentUser || !currentNearbyAvEnabled || !currentLocalStream) return;
            if (!payload.sdp) return;

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
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      type: 'client.webrtc.answer',
                      payload: {
                        to_user_id: payload.from_user_id,
                        sdp: pc.localDescription?.sdp,
                      },
                    })
                  );
                }
              })
              .catch((err) => console.error('Error handling offer:', err));
            break;
          }
          case 'server.webrtc.answer': {
            const payload = message.payload as WebRTCSignalPayload;
            if (!payload.sdp) return;

            const peerConnections = useStore.getState().peerConnections;
            const peerConn = peerConnections.get(payload.from_user_id);
            if (!peerConn) return;

            peerConn.pc
              .setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }))
              .catch((err) => console.error('Error handling answer:', err));
            break;
          }
          case 'server.webrtc.ice': {
            const payload = message.payload as WebRTCSignalPayload;
            if (!payload.candidate) return;

            const peerConnections = useStore.getState().peerConnections;
            const peerConn = peerConnections.get(payload.from_user_id);
            if (!peerConn) return;

            peerConn.pc
              .addIceCandidate(new RTCIceCandidate(payload.candidate))
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
    ]
  );

  // Main connection effect
  useEffect(() => {
    if (!token || !spaceId) return;
    if (wsRef.current || isConnectingRef.current) return;

    isConnectingRef.current = true;

    const wsUrl = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&space_id=${spaceId}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected');
      isConnectingRef.current = false;
      setWsConnected(true);
      setWs(socket);
    };

    socket.onmessage = handleMessage;

    socket.onclose = (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
      isConnectingRef.current = false;
      setWsConnected(false);
      setWs(null);
      wsRef.current = null;

      // Clean up peer connections on disconnect
      clearPeerConnections();

      // Reconnect after 2 seconds if not a clean close
      if (event.code !== 1000) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          // Trigger reconnect by updating a ref that causes useEffect to re-run
          wsRef.current = null;
        }, 2000);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      isConnectingRef.current = false;
    };

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
      isConnectingRef.current = false;
      clearPeerConnections();
    };
  }, [token, spaceId, handleMessage, setWs, setWsConnected, clearPeerConnections]);

  const sendMessage = useCallback((type: string, payload: unknown): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }, []);

  const sendMove = useCallback(
    (x: number, y: number, dir: string) => {
      sendMessage('client.move', { x, y, dir });
    },
    [sendMessage]
  );

  const sendChat = useCallback(
    (channel: string, body: string): boolean => {
      return sendMessage('client.chat.send', { channel, body });
    },
    [sendMessage]
  );

  return { sendMove, sendChat, sendMessage };
}
