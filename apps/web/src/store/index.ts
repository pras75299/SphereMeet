import { create } from 'zustand';

/**
 * One canonical string for user IDs so JWT, REST, and WebSocket JSON always match the same Map key
 * (fixes missing self in presence → arrows do nothing, and peers showing as "Unknown").
 */
export function canonicalUserId(raw: string): string {
  const s = String(raw).trim().toLowerCase();
  if (s.length === 32 && !s.includes('-')) {
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return s;
}

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

/** Activity COMMS: mesh only with proximity peers. Meetings: mesh with everyone in the office who is also in `space` scope. */
export type AvScopeMode = 'proximity' | 'space';

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
  updatePresence: (
    presence: Pick<UserPresence, 'user_id' | 'x' | 'y' | 'dir' | 'zone_id'> & {
      display_name?: string;
    },
  ) => void;
  removePresence: (userId: string) => void;

  /** Server-synced: who is in Meetings (space) vs Activity (proximity) A/V mode */
  peerAvScopes: Record<string, AvScopeMode>;
  setPeerAvScopesFromJoined: (scopes: Record<string, string>) => void;
  patchPeerAvScope: (userId: string, scope: AvScopeMode) => void;

  /** Local WebRTC peer selection mode */
  avScope: AvScopeMode;
  setAvScope: (scope: AvScopeMode) => void;

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
      if (user?.id) {
        user = { ...user, id: canonicalUserId(user.id) };
      }
    } catch {
      user = null;
    }
    set({ token, user, isHydrated: true });
  },

  // Auth - start with null, hydrate will populate from localStorage
  token: null,
  user: null,
  setAuth: (token, user) => {
    const normalized = { ...user, id: canonicalUserId(user.id) };
    setStorageItem('token', token);
    setStorageItem('user', JSON.stringify(normalized));
    set({ token, user: normalized });
  },
  clearAuth: () => {
    const s = get();
    try {
      s.ws?.close(1000, 'logout');
    } catch {
      /* ignore */
    }
    removeStorageItem('token');
    removeStorageItem('user');
    s.localStream?.getTracks().forEach((t) => t.stop());
    s.peerConnections.forEach((pc) => pc.pc.close());
    set({
      token: null,
      user: null,
      localStream: null,
      nearbyAvEnabled: false,
      avScope: 'proximity',
      peerAvScopes: {},
      peerConnections: new Map(),
      ws: null,
      wsConnected: false,
    });
  },

  // Space
  spaceId: null,
  spaceName: null,
  setSpace: (id, name) => set({ spaceId: id, spaceName: name }),

  // Map
  map: null,
  zones: [],
  setMap: (map, zones) => {
    if (!map) {
      set({ map: null, zones });
      return;
    }
    // JSONB / serde may deserialize numbers as strings; normalize for .includes() checks
    const blockedRaw = map.blocked;
    const blocked = Array.isArray(blockedRaw)
      ? blockedRaw
          .map((n) => (typeof n === 'number' ? n : Number(n)))
          .filter((n) => Number.isFinite(n))
      : [];
    set({ map: { ...map, blocked }, zones });
  },

  // Presence
  presence: new Map(),
  setPresence: (presenceList) => {
    const presenceMap = new Map<string, UserPresence>();
    presenceList.forEach((p) => {
      const id = canonicalUserId(p.user_id);
      const dn = p.display_name?.trim();
      presenceMap.set(id, {
        ...p,
        user_id: id,
        display_name: dn && dn.length > 0 ? dn : 'Unknown',
      });
    });
    set((state) => {
      const nextScopes: Record<string, AvScopeMode> = {};
      for (const [k, v] of Object.entries(state.peerAvScopes)) {
        const ck = canonicalUserId(k);
        if (presenceMap.has(ck)) nextScopes[ck] = v;
      }
      return { presence: presenceMap, peerAvScopes: nextScopes };
    });
  },
  updatePresence: (presence) => {
    set((state) => {
      const id = canonicalUserId(presence.user_id);
      const newPresence = new Map(state.presence);
      const existing = newPresence.get(id);
      const incomingName = presence.display_name?.trim();
      const displayName =
        incomingName && incomingName.length > 0
          ? incomingName
          : (existing?.display_name ?? 'Unknown');
      newPresence.set(id, {
        user_id: id,
        x: presence.x,
        y: presence.y,
        dir: presence.dir,
        zone_id: presence.zone_id,
        display_name: displayName,
      });
      return { presence: newPresence };
    });
  },
  removePresence: (userId) => {
    const id = canonicalUserId(userId);
    set((state) => {
      const newPresence = new Map(state.presence);
      newPresence.delete(id);
      const nextScopes: Record<string, AvScopeMode> = {};
      for (const [k, v] of Object.entries(state.peerAvScopes)) {
        const ck = canonicalUserId(k);
        if (ck !== id) nextScopes[ck] = v;
      }
      return { presence: newPresence, peerAvScopes: nextScopes };
    });
  },

  peerAvScopes: {},
  setPeerAvScopesFromJoined: (scopes) => {
    const normalized: Record<string, AvScopeMode> = {};
    for (const [k, v] of Object.entries(scopes)) {
      normalized[canonicalUserId(k)] = v === 'space' ? 'space' : 'proximity';
    }
    set({ peerAvScopes: normalized });
  },
  patchPeerAvScope: (userId, scope) => {
    const id = canonicalUserId(userId);
    set((state) => ({
      peerAvScopes: { ...state.peerAvScopes, [id]: scope },
    }));
  },

  avScope: 'proximity',
  setAvScope: (scope) => set({ avScope: scope }),

  // Proximity
  proximityPeers: [],
  setProximityPeers: (peers) =>
    set({ proximityPeers: peers.map((id) => canonicalUserId(id)) }),

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
    const id = canonicalUserId(userId);
    set((state) => {
      const newPeerConnections = new Map(state.peerConnections);
      newPeerConnections.set(id, { pc, remoteStream });
      return { peerConnections: newPeerConnections };
    });
  },
  updatePeerStream: (userId, stream) => {
    const id = canonicalUserId(userId);
    set((state) => {
      const newPeerConnections = new Map(state.peerConnections);
      const existing = newPeerConnections.get(id);
      if (existing) {
        newPeerConnections.set(id, { ...existing, remoteStream: stream });
      }
      return { peerConnections: newPeerConnections };
    });
  },
  removePeerConnection: (userId) => {
    const id = canonicalUserId(userId);
    const state = get();
    const peerConn = state.peerConnections.get(id);
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
      newPeerConnections.delete(id);
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
