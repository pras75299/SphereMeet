'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useStore, UserPresence, ChatMessage } from '@/store';

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
  const {
    token,
    user,
    setSpace,
    setMap,
    setPresence,
    updatePresence,
    removePresence,
    setProximityPeers,
    addChatMessage,
    ws,
    setWs,
    setWsConnected,
    nearbyAvEnabled,
    localStream,
    peerConnections,
    setPeerConnection,
    updatePeerStream,
    removePeerConnection,
  } = useStore();

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean) => {
      if (!user || !ws || !localStream) return null;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Add local tracks
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
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
    [user, localStream, setPeerConnection, updatePeerStream]
  );

  const handleProximityUpdate = useCallback(
    (peers: string[]) => {
      if (!user || !nearbyAvEnabled || !localStream) {
        setProximityPeers(peers);
        return;
      }

      const desiredPeers = new Set(peers);
      const currentPeers = new Set(peerConnections.keys());

      // Connect to new peers
      desiredPeers.forEach((peerId) => {
        if (!currentPeers.has(peerId)) {
          // Determine who initiates (lower user_id string initiates)
          const isInitiator = user.id < peerId;
          createPeerConnection(peerId, isInitiator);
        }
      });

      // Disconnect from peers no longer in range
      currentPeers.forEach((peerId) => {
        if (!desiredPeers.has(peerId)) {
          removePeerConnection(peerId);
        }
      });

      setProximityPeers(peers);
    },
    [user, nearbyAvEnabled, localStream, peerConnections, createPeerConnection, removePeerConnection, setProximityPeers]
  );

  const handleWebRTCOffer = useCallback(
    async (payload: WebRTCSignalPayload) => {
      if (!user || !nearbyAvEnabled || !localStream) return;

      const { from_user_id, sdp } = payload;
      if (!sdp) return;

      let peerConn = peerConnections.get(from_user_id);
      let pc: RTCPeerConnection;

      if (!peerConn) {
        // Create new peer connection (we received an offer, so we're not initiator)
        const newPc = createPeerConnection(from_user_id, false);
        if (!newPc) return;
        pc = newPc;
      } else {
        pc = peerConn.pc;
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'client.webrtc.answer',
              payload: {
                to_user_id: from_user_id,
                sdp: pc.localDescription?.sdp,
              },
            })
          );
        }
      } catch (err) {
        console.error('Error handling offer:', err);
      }
    },
    [user, nearbyAvEnabled, localStream, peerConnections, createPeerConnection]
  );

  const handleWebRTCAnswer = useCallback(
    async (payload: WebRTCSignalPayload) => {
      const { from_user_id, sdp } = payload;
      if (!sdp) return;

      const peerConn = peerConnections.get(from_user_id);
      if (!peerConn) return;

      try {
        await peerConn.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    },
    [peerConnections]
  );

  const handleWebRTCIce = useCallback(
    async (payload: WebRTCSignalPayload) => {
      const { from_user_id, candidate } = payload;
      if (!candidate) return;

      const peerConn = peerConnections.get(from_user_id);
      if (!peerConn) return;

      try {
        await peerConn.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    },
    [peerConnections]
  );

  const connect = useCallback(() => {
    if (!token || !spaceId) return;

    const wsUrl = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&space_id=${spaceId}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected');
      setWsConnected(true);
      setWs(socket);
    };

    socket.onmessage = (event) => {
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
            handleProximityUpdate(payload.peers);
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
            handleWebRTCOffer(message.payload as WebRTCSignalPayload);
            break;
          }
          case 'server.webrtc.answer': {
            handleWebRTCAnswer(message.payload as WebRTCSignalPayload);
            break;
          }
          case 'server.webrtc.ice': {
            handleWebRTCIce(message.payload as WebRTCSignalPayload);
            break;
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnected(false);
      setWs(null);
      wsRef.current = null;

      // Reconnect after 2 seconds
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 2000);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [
    token,
    spaceId,
    setWs,
    setWsConnected,
    setSpace,
    setMap,
    setPresence,
    updatePresence,
    removePresence,
    addChatMessage,
    handleProximityUpdate,
    handleWebRTCOffer,
    handleWebRTCAnswer,
    handleWebRTCIce,
  ]);

  useEffect(() => {
    if (token && spaceId && !ws) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token, spaceId, ws, connect]);

  const sendMessage = useCallback(
    (type: string, payload: unknown) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type, payload }));
      }
    },
    []
  );

  const sendMove = useCallback(
    (x: number, y: number, dir: string) => {
      sendMessage('client.move', { x, y, dir });
    },
    [sendMessage]
  );

  const sendChat = useCallback(
    (channel: string, body: string) => {
      sendMessage('client.chat.send', { channel, body });
    },
    [sendMessage]
  );

  return { sendMove, sendChat, sendMessage };
}
