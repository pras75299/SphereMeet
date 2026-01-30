// Shared types between frontend and backend

export interface User {
  id: string;
  display_name: string;
}

export interface Space {
  id: string;
  name: string;
}

export interface MapData {
  map_id: string;
  width: number;
  height: number;
  tiles: number[];
  blocked: number[];
}

export interface Zone {
  zone_id: string;
  name: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UserPresence {
  user_id: string;
  display_name: string;
  x: number;
  y: number;
  dir: 'up' | 'down' | 'left' | 'right';
  zone_id: string | null;
}

export interface ChatMessage {
  id: string;
  channel: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
}

// WebSocket message types
export type WsMessageType =
  | 'client.join'
  | 'client.move'
  | 'client.chat.send'
  | 'client.webrtc.offer'
  | 'client.webrtc.answer'
  | 'client.webrtc.ice'
  | 'server.joined'
  | 'server.presence.update'
  | 'server.presence.leave'
  | 'server.proximity'
  | 'server.chat.new'
  | 'server.webrtc.offer'
  | 'server.webrtc.answer'
  | 'server.webrtc.ice';

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
}

// Specific message payloads
export interface JoinedPayload {
  self: { user_id: string; display_name: string };
  space: { space_id: string; name: string };
  map: MapData | null;
  zones: Zone[];
  presence: UserPresence[];
}

export interface PresenceUpdatePayload {
  user_id: string;
  display_name?: string;
  x: number;
  y: number;
  dir: string;
  zone_id: string | null;
}

export interface PresenceLeavePayload {
  user_id: string;
}

export interface ProximityPayload {
  peers: string[];
}

export interface ChatNewPayload {
  id: string;
  channel: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
}

export interface WebRTCSignalPayload {
  from_user_id: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}
