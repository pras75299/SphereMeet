import { create } from 'zustand';

// Helper to safely access localStorage
const getStorageItem = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStorageItem = (key: string, value: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
};

const removeStorageItem = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
};

export interface User {
  id: string;
  display_name: string;
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

export interface PeerConnection {
  pc: RTCPeerConnection;
  remoteStream: MediaStream | null;
}

interface AppState {
  // Hydration
  isHydrated: boolean;
  hydrate: () => void;

  // Auth
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;

  // Space
  spaceId: string | null;
  spaceName: string | null;
  setSpace: (id: string, name: string) => void;

  // Map
  map: MapData | null;
  zones: Zone[];
  setMap: (map: MapData | null, zones: Zone[]) => void;

  // Presence
  presence: Map<string, UserPresence>;
  setPresence: (presence: UserPresence[]) => void;
  updatePresence: (presence: UserPresence) => void;
  removePresence: (userId: string) => void;

  // Proximity
  proximityPeers: string[];
  setProximityPeers: (peers: string[]) => void;

  // Chat
  chatMessages: Map<string, ChatMessage[]>;
  currentChannel: string;
  addChatMessage: (message: ChatMessage) => void;
  setChatMessages: (channel: string, messages: ChatMessage[]) => void;
  setCurrentChannel: (channel: string) => void;

  // A/V
  localStream: MediaStream | null;
  setLocalStream: (stream: MediaStream | null) => void;
  nearbyAvEnabled: boolean;
  setNearbyAvEnabled: (enabled: boolean) => void;

  // Peer Connections
  peerConnections: Map<string, PeerConnection>;
  setPeerConnection: (userId: string, pc: RTCPeerConnection, remoteStream: MediaStream | null) => void;
  updatePeerStream: (userId: string, stream: MediaStream) => void;
  removePeerConnection: (userId: string) => void;
  clearPeerConnections: () => void;

  // WebSocket
  ws: WebSocket | null;
  setWs: (ws: WebSocket | null) => void;
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Hydration - start with null to avoid SSR mismatch
  isHydrated: false,
  hydrate: () => {
    const token = getStorageItem('token');
    const userStr = getStorageItem('user');
    let user: User | null = null;
    try {
      user = userStr ? JSON.parse(userStr) : null;
    } catch {
      user = null;
    }
    set({ token, user, isHydrated: true });
  },

  // Auth - start with null, hydrate will populate from localStorage
  token: null,
  user: null,
  setAuth: (token, user) => {
    setStorageItem('token', token);
    setStorageItem('user', JSON.stringify(user));
    set({ token, user });
  },
  clearAuth: () => {
    removeStorageItem('token');
    removeStorageItem('user');
    set({ token: null, user: null });
  },

  // Space
  spaceId: null,
  spaceName: null,
  setSpace: (id, name) => set({ spaceId: id, spaceName: name }),

  // Map
  map: null,
  zones: [],
  setMap: (map, zones) => set({ map, zones }),

  // Presence
  presence: new Map(),
  setPresence: (presenceList) => {
    const presenceMap = new Map<string, UserPresence>();
    presenceList.forEach((p) => presenceMap.set(p.user_id, p));
    set({ presence: presenceMap });
  },
  updatePresence: (presence) => {
    set((state) => {
      const newPresence = new Map(state.presence);
      const existing = newPresence.get(presence.user_id);
      newPresence.set(presence.user_id, {
        ...existing,
        ...presence,
        display_name: presence.display_name || existing?.display_name || 'Unknown',
      } as UserPresence);
      return { presence: newPresence };
    });
  },
  removePresence: (userId) => {
    set((state) => {
      const newPresence = new Map(state.presence);
      newPresence.delete(userId);
      return { presence: newPresence };
    });
  },

  // Proximity
  proximityPeers: [],
  setProximityPeers: (peers) => set({ proximityPeers: peers }),

  // Chat
  chatMessages: new Map(),
  currentChannel: 'general',
  addChatMessage: (message) => {
    set((state) => {
      const newMessages = new Map(state.chatMessages);
      const channelMessages = newMessages.get(message.channel) || [];
      newMessages.set(message.channel, [...channelMessages, message]);
      return { chatMessages: newMessages };
    });
  },
  setChatMessages: (channel, messages) => {
    set((state) => {
      const newMessages = new Map(state.chatMessages);
      newMessages.set(channel, messages);
      return { chatMessages: newMessages };
    });
  },
  setCurrentChannel: (channel) => set({ currentChannel: channel }),

  // A/V
  localStream: null,
  setLocalStream: (stream) => set({ localStream: stream }),
  nearbyAvEnabled: false,
  setNearbyAvEnabled: (enabled) => set({ nearbyAvEnabled: enabled }),

  // Peer Connections
  peerConnections: new Map(),
  setPeerConnection: (userId, pc, remoteStream) => {
    set((state) => {
      const newPeerConnections = new Map(state.peerConnections);
      newPeerConnections.set(userId, { pc, remoteStream });
      return { peerConnections: newPeerConnections };
    });
  },
  updatePeerStream: (userId, stream) => {
    set((state) => {
      const newPeerConnections = new Map(state.peerConnections);
      const existing = newPeerConnections.get(userId);
      if (existing) {
        newPeerConnections.set(userId, { ...existing, remoteStream: stream });
      }
      return { peerConnections: newPeerConnections };
    });
  },
  removePeerConnection: (userId) => {
    const state = get();
    const peerConn = state.peerConnections.get(userId);
    if (peerConn) {
      peerConn.pc.getSenders().forEach((sender) => {
        try {
          peerConn.pc.removeTrack(sender);
        } catch (e) {
          // Ignore errors
        }
      });
      peerConn.pc.close();
    }
    set((state) => {
      const newPeerConnections = new Map(state.peerConnections);
      newPeerConnections.delete(userId);
      return { peerConnections: newPeerConnections };
    });
  },
  clearPeerConnections: () => {
    const state = get();
    state.peerConnections.forEach((peerConn) => {
      peerConn.pc.getSenders().forEach((sender) => {
        try {
          peerConn.pc.removeTrack(sender);
        } catch (e) {
          // Ignore errors
        }
      });
      peerConn.pc.close();
    });
    set({ peerConnections: new Map() });
  },

  // WebSocket
  ws: null,
  setWs: (ws) => set({ ws }),
  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),
}));
