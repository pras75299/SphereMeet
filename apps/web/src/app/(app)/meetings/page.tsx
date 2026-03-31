'use client';

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from 'react';
import { useStore } from '@/store';
import { useWebSocketContext } from '@/hooks/WebSocketProvider';

type Phase = 'lobby' | 'meeting';
type ViewMode = 'gallery' | 'speaker';

// ─── Participant tile ──────────────────────────────────────────────────────────

interface TileParticipant {
  id: string;
  displayName: string;
  isSelf: boolean;
}

interface ParticipantTileProps {
  participant: TileParticipant;
  stream: MediaStream | null;
  isActive: boolean;
  isVideoOff: boolean;
  isMuted: boolean;
  isSelf: boolean;
  isPinned: boolean;
  large?: boolean;
  onPin: () => void;
  onTrackAvailable?: (stream: MediaStream) => void;
}

function ParticipantTile({
  participant,
  stream,
  isActive,
  isVideoOff,
  isMuted,
  isSelf,
  isPinned,
  large,
  onPin,
  onTrackAvailable,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const didNotify = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
      if (!didNotify.current && onTrackAvailable) {
        onTrackAvailable(stream);
        didNotify.current = true;
      }
    } else {
      el.srcObject = null;
    }
  }, [stream, onTrackAvailable]);

  const initials = participant.displayName
    .split(' ')
    .map((n) => n[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const hasVideo = stream && !isVideoOff;

  return (
    <div
      className="relative flex h-full w-full overflow-hidden"
      style={{
        background: '#0d1117',
        outline: isActive ? '2px solid #ffe083' : '1px solid rgba(192,193,255,0.1)',
        boxShadow: large ? '4px 4px 0 0 #060810' : undefined,
        cursor: 'pointer',
      }}
      onClick={onPin}
    >
      {/* Video */}
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted={isSelf}
          playsInline
          className="h-full w-full object-cover"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: '#111827' }}
        >
          <div
            className="flex items-center justify-center text-sm font-bold"
            style={{
              width: large ? '96px' : '48px',
              height: large ? '96px' : '48px',
              background: '#c0c1ff',
              color: '#1000a9',
              fontFamily: "'Space Grotesk', monospace",
              boxShadow: '4px 4px 0 0 #494bd6',
            }}
          >
            {initials}
          </div>
        </div>
      )}

      {/* Name bar */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1"
        style={{ background: 'rgba(0,0,0,0.75)', borderTop: '2px solid #0a0e14' }}
      >
        <span
          className="truncate pixel-mono text-[9px] font-bold uppercase tracking-wider"
          style={{ color: '#dfe2eb', fontFamily: "'Space Grotesk', monospace" }}
        >
          {participant.displayName.toUpperCase().replace(/\s+/g, '_')}
          {isSelf ? ' (YOU)' : ''}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {isMuted && (
            <span
              className="pixel-mono text-[8px] font-bold uppercase px-1"
              style={{ background: '#b91c1c', color: '#fecaca' }}
            >
              MUTE
            </span>
          )}
          {isVideoOff && (
            <span
              className="pixel-mono text-[8px] font-bold uppercase px-1"
              style={{ background: '#b91c1c', color: '#fecaca' }}
            >
              NO_CAM
            </span>
          )}
          {isPinned && (
            <span
              className="pixel-mono text-[8px] font-bold uppercase px-1"
              style={{ background: '#ffe083', color: '#1000a9' }}
            >
              PIN
            </span>
          )}
          {isActive && !isSelf && (
            <span
              className="pixel-mono text-[8px] font-bold uppercase"
              style={{ color: '#ffe083' }}
            >
              &#9670;
            </span>
          )}
        </div>
      </div>

      {/* Connecting overlay */}
      {!isSelf && !stream && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(17,24,39,0.8)' }}
        >
          <span
            className="pixel-mono text-[9px] uppercase tracking-widest animate-pulse"
            style={{ color: '#8082b4', fontFamily: "'Space Grotesk', monospace" }}
          >
            CONNECTING...
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Control button ────────────────────────────────────────────────────────────

interface CtrlBtnProps {
  onClick: () => void;
  label: string;
  sublabel?: string;
  active: boolean;
  danger?: boolean;
  accent?: boolean;
}

function CtrlBtn({ onClick, label, sublabel, active, danger, accent }: CtrlBtnProps) {
  const bg = danger
    ? '#b91c1c'
    : accent
      ? '#1e3a2f'
      : active
        ? '#1e2535'
        : '#2a1a1a';

  const color = danger
    ? '#fecaca'
    : accent
      ? '#4ade80'
      : active
        ? '#c0c1ff'
        : '#ef4444';

  const borderColor = danger
    ? '#7f1d1d'
    : accent
      ? '#14532d'
      : active
        ? '#131829'
        : '#1a0a0a';

  return (
    <button
      type="button"
      onClick={onClick}
      className="pixel-btn flex flex-col items-center gap-0.5 px-3 py-2 transition-[transform,border-bottom-width] duration-100 active:translate-y-0.5 active:border-b-0"
      style={{
        background: bg,
        color,
        borderBottom: `4px solid ${borderColor}`,
        minWidth: '56px',
      }}
    >
      <span
        className="pixel-mono text-[10px] font-bold uppercase tracking-wider"
        style={{ fontFamily: "'Space Grotesk', monospace" }}
      >
        {label}
      </span>
      {sublabel && (
        <span
          className="pixel-mono text-[8px] uppercase tracking-wider opacity-70"
          style={{ fontFamily: "'Space Grotesk', monospace" }}
        >
          {sublabel}
        </span>
      )}
    </button>
  );
}

// ─── Dynamic grid columns ──────────────────────────────────────────────────────

function gridColsForCount(n: number): string {
  if (n === 1) return '1';
  if (n === 2) return '2';
  if (n <= 4) return '2';
  if (n <= 9) return '3';
  return '4';
}

// ─── Meetings content ──────────────────────────────────────────────────────────

function MeetingsContent() {
  const [phase, setPhase] = useState<Phase>('lobby');
  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [pinnedUserId, setPinnedUserId] = useState<string | null>(null);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  const inMeetingRef = useRef(false);
  const lobbyVideoRef = useRef<HTMLVideoElement>(null);
  const lobbyStreamRef = useRef<MediaStream | null>(null);
  const audioAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const user = useStore((s) => s.user);
  const presence = useStore((s) => s.presence);
  const peerConnections = useStore((s) => s.peerConnections);
  const localStream = useStore((s) => s.localStream);
  const setLocalStream = useStore((s) => s.setLocalStream);
  const setNearbyAvEnabled = useStore((s) => s.setNearbyAvEnabled);
  const setAvScope = useStore((s) => s.setAvScope);
  const clearPeerConnections = useStore((s) => s.clearPeerConnections);
  const { sendMessage } = useWebSocketContext();

  useEffect(() => {
    inMeetingRef.current = phase === 'meeting';
  }, [phase]);

  // ── Lobby camera preview ───────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'lobby') return;
    let live = true;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((stream) => {
        if (!live) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        // Silence audio in preview to prevent feedback
        stream.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
        lobbyStreamRef.current = stream;
        if (lobbyVideoRef.current) lobbyVideoRef.current.srcObject = stream;
      })
      .catch(() => {});
    return () => {
      live = false;
      lobbyStreamRef.current?.getTracks().forEach((t) => t.stop());
      lobbyStreamRef.current = null;
    };
  }, [phase]);

  // ── Unmount cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    const { setLocalStream, setNearbyAvEnabled, setAvScope, clearPeerConnections } =
      useStore.getState();
    return () => {
      if (!inMeetingRef.current) return;
      const { ws, localStream } = useStore.getState();
      ws?.send(
        JSON.stringify({ type: 'client.av.scope', payload: { scope: 'proximity' } }),
      );
      localStream?.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
      setNearbyAvEnabled(false);
      setAvScope('proximity');
      clearPeerConnections();
    };
  }, []);

  // ── Active speaker detection ───────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'meeting') return;

    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const poll = () => {
      let maxVol = 0;
      let speaker: string | null = null;
      audioAnalysersRef.current.forEach((analyser, uid) => {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        const vol = buf.reduce((a, b) => a + b, 0) / buf.length;
        if (vol > maxVol && vol > 8) {
          maxVol = vol;
          speaker = uid;
        }
      });
      setActiveSpeakerId(speaker);
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioAnalysersRef.current.clear();
      ctx.close().catch(() => {});
    };
  }, [phase]);

  const setupAudioAnalyser = useCallback((userId: string, stream: MediaStream) => {
    const ctx = audioContextRef.current;
    if (!ctx || audioAnalysersRef.current.has(userId)) return;
    const tracks = stream.getAudioTracks();
    if (!tracks.length) return;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    audioAnalysersRef.current.set(userId, analyser);
  }, []);

  // ── Join / Leave ───────────────────────────────────────────────────────────
  const joinMeeting = useCallback(async () => {
    try {
      lobbyStreamRef.current?.getTracks().forEach((t) => t.stop());
      lobbyStreamRef.current = null;

      const constraints = { audio: true, video: !isVideoOff };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (isMuted) stream.getAudioTracks().forEach((t) => { t.enabled = false; });
      if (isVideoOff) stream.getVideoTracks().forEach((t) => { t.enabled = false; });

      setLocalStream(stream);
      setNearbyAvEnabled(true);
      setAvScope('space');
      sendMessage('client.av.scope', { scope: 'space' });
      setPhase('meeting');
    } catch {
      alert('Could not access camera/microphone. Please check permissions and try again.');
    }
  }, [isVideoOff, isMuted, setLocalStream, setNearbyAvEnabled, setAvScope, sendMessage]);

  const leaveMeeting = useCallback(() => {
    sendMessage('client.av.scope', { scope: 'proximity' });
    const stream = useStore.getState().localStream;
    stream?.getTracks().forEach((t) => t.stop());
    screenStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setNearbyAvEnabled(false);
    setAvScope('proximity');
    clearPeerConnections();
    setPhase('lobby');
    setIsMuted(false);
    setIsVideoOff(false);
    setIsSharing(false);
    setScreenStream(null);
    setPinnedUserId(null);
    audioAnalysersRef.current.clear();
  }, [
    sendMessage,
    setLocalStream,
    setNearbyAvEnabled,
    setAvScope,
    clearPeerConnections,
    screenStream,
  ]);

  // ── Mic / Camera ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    const stream = useStore.getState().localStream;
    const track = stream?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    } else {
      setIsMuted((m) => !m);
    }
  }, []);

  const toggleVideo = useCallback(() => {
    const stream = useStore.getState().localStream;
    const track = stream?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsVideoOff(!track.enabled);
    } else {
      setIsVideoOff((v) => !v);
    }
  }, []);

  // ── Screen share ───────────────────────────────────────────────────────────
  const restoreCameraTrack = useCallback(() => {
    const stream = useStore.getState().localStream;
    const videoTrack = stream?.getVideoTracks()[0];
    if (!videoTrack) return;
    useStore.getState().peerConnections.forEach(({ pc }) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      sender?.replaceTrack(videoTrack).catch(() => {});
    });
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (isSharing) {
      screenStream?.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      setIsSharing(false);
      restoreCameraTrack();
      return;
    }
    try {
      const dispStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = dispStream.getVideoTracks()[0];

      useStore.getState().peerConnections.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        sender?.replaceTrack(screenTrack).catch(() => {});
      });

      screenTrack.onended = () => {
        setScreenStream(null);
        setIsSharing(false);
        restoreCameraTrack();
      };

      setScreenStream(dispStream);
      setIsSharing(true);
    } catch {
      // User cancelled or permission denied
    }
  }, [isSharing, screenStream, restoreCameraTrack]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const remoteParticipants = useMemo(() => {
    if (!user) return [];
    return Array.from(presence.values())
      .filter((p) => p.user_id !== user.id)
      .sort((a, b) => a.user_id.localeCompare(b.user_id));
  }, [presence, user]);

  const allParticipants: TileParticipant[] = useMemo(
    () => [
      { id: user?.id ?? 'self', displayName: user?.display_name ?? 'You', isSelf: true },
      ...remoteParticipants.map((p) => ({
        id: p.user_id,
        displayName: p.display_name,
        isSelf: false,
      })),
    ],
    [user, remoteParticipants],
  );

  const totalCount = allParticipants.length;

  const featuredId =
    pinnedUserId ??
    activeSpeakerId ??
    (remoteParticipants[0]?.user_id ?? allParticipants[0]?.id ?? null);

  const getStream = useCallback(
    (p: TileParticipant): MediaStream | null => {
      if (p.isSelf) return isSharing ? screenStream : localStream;
      return peerConnections.get(p.id)?.remoteStream ?? null;
    },
    [isSharing, screenStream, localStream, peerConnections],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // LOBBY
  // ─────────────────────────────────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div
        className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
        style={{ background: '#0f131d' }}
      >
        {/* CRT scanline */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background:
              'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)',
          }}
        />

        {/* Header */}
        <header
          className="relative z-10 flex shrink-0 items-center justify-between px-4 py-2"
          style={{ background: '#181c26', boxShadow: '0 4px 0 0 #0a0d16' }}
        >
          <span
            className="pixel-mono text-xs font-bold uppercase tracking-[0.25em]"
            style={{ color: '#c0c1ff', fontFamily: "'Space Grotesk', monospace" }}
          >
            SphereMeet
          </span>
          <span
            className="pixel-mono text-[9px] uppercase tracking-wider"
            style={{ color: '#8082b4', fontFamily: "'Space Grotesk', monospace" }}
          >
            LOBBY &middot; PRE-JOIN
          </span>
        </header>

        {/* Body */}
        <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex w-full max-w-4xl flex-col gap-6 lg:flex-row lg:items-start">

            {/* Camera preview */}
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2">
                <span className="pixel-badge-on" />
                <span
                  className="pixel-mono text-[9px] uppercase tracking-widest"
                  style={{ color: '#8082b4', fontFamily: "'Space Grotesk', monospace" }}
                >
                  CAMERA_PREVIEW
                </span>
              </div>

              <div
                className="relative w-full overflow-hidden"
                style={{
                  aspectRatio: '16/9',
                  background: '#0d1117',
                  boxShadow: '4px 4px 0 0 #060810',
                  outline: '1px solid rgba(192,193,255,0.15)',
                }}
              >
                <video
                  ref={lobbyVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                  style={{ display: isVideoOff ? 'none' : 'block' }}
                />
                {isVideoOff && (
                  <div
                    className="flex h-full w-full items-center justify-center"
                    style={{ background: '#111827' }}
                  >
                    <div
                      className="flex h-24 w-24 items-center justify-center text-xl font-bold"
                      style={{
                        background: '#c0c1ff',
                        color: '#1000a9',
                        fontFamily: "'Space Grotesk', monospace",
                        boxShadow: '4px 4px 0 0 #494bd6',
                      }}
                    >
                      {user?.display_name
                        .split(' ')
                        .map((n) => n[0] ?? '')
                        .join('')
                        .toUpperCase()
                        .slice(0, 2) ?? '?'}
                    </div>
                  </div>
                )}

                {/* Name bar */}
                <div
                  className="absolute bottom-0 left-0 right-0 px-3 py-1.5"
                  style={{ background: 'rgba(0,0,0,0.72)', borderTop: '2px solid #0a0e14' }}
                >
                  <span
                    className="pixel-mono text-[10px] uppercase tracking-wider"
                    style={{ color: '#dfe2eb', fontFamily: "'Space Grotesk', monospace" }}
                  >
                    {(user?.display_name ?? 'YOU').toUpperCase().replace(/\s+/g, '_')}
                  </span>
                </div>

                {/* Status badges */}
                <div className="absolute right-2 top-2 flex flex-col gap-1">
                  {isMuted && (
                    <span
                      className="pixel-mono px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                      style={{ background: '#b91c1c', color: '#fecaca' }}
                    >
                      MIC OFF
                    </span>
                  )}
                  {isVideoOff && (
                    <span
                      className="pixel-mono px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
                      style={{ background: '#b91c1c', color: '#fecaca' }}
                    >
                      CAM OFF
                    </span>
                  )}
                </div>
              </div>

              {/* Preview controls */}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="pixel-btn flex flex-1 items-center justify-center gap-1.5 py-2.5 pixel-mono text-[10px] font-bold uppercase tracking-wider transition-[transform,border-bottom-width] duration-100 active:translate-y-0.5 active:border-b-0"
                  style={{
                    background: isMuted ? '#b91c1c' : '#1e2535',
                    color: isMuted ? '#fecaca' : '#c0c1ff',
                    borderBottom: `4px solid ${isMuted ? '#7f1d1d' : '#131829'}`,
                    fontFamily: "'Space Grotesk', monospace",
                  }}
                >
                  <span
                    className="pixel-mono text-[10px] font-bold"
                    style={{ fontFamily: 'monospace' }}
                  >
                    {isMuted ? '[X]' : '[M]'}
                  </span>
                  <span>{isMuted ? 'MIC_OFF' : 'MIC_ON'}</span>
                </button>

                <button
                  type="button"
                  onClick={toggleVideo}
                  className="pixel-btn flex flex-1 items-center justify-center gap-1.5 py-2.5 pixel-mono text-[10px] font-bold uppercase tracking-wider transition-[transform,border-bottom-width] duration-100 active:translate-y-0.5 active:border-b-0"
                  style={{
                    background: isVideoOff ? '#b91c1c' : '#1e2535',
                    color: isVideoOff ? '#fecaca' : '#c0c1ff',
                    borderBottom: `4px solid ${isVideoOff ? '#7f1d1d' : '#131829'}`,
                    fontFamily: "'Space Grotesk', monospace",
                  }}
                >
                  <span
                    className="pixel-mono text-[10px] font-bold"
                    style={{ fontFamily: 'monospace' }}
                  >
                    {isVideoOff ? '[X]' : '[C]'}
                  </span>
                  <span>{isVideoOff ? 'CAM_OFF' : 'CAM_ON'}</span>
                </button>
              </div>
            </div>

            {/* Join panel */}
            <div className="w-full lg:w-72 lg:shrink-0">
              <div
                className="p-6"
                style={{
                  background: '#1c2026',
                  boxShadow: '4px 4px 0 0 #0a0e14',
                  outline: '1px solid rgba(192,193,255,0.15)',
                }}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="pixel-badge-on" />
                  <span
                    className="pixel-mono text-[9px] uppercase tracking-[0.2em]"
                    style={{ color: '#8082b4', fontFamily: "'Space Grotesk', monospace" }}
                  >
                    &gt; CONF_ROOM
                  </span>
                </div>

                <h2
                  className="mb-1 text-xl font-bold uppercase tracking-widest"
                  style={{ fontFamily: "'Space Grotesk', monospace", color: '#dfe2eb' }}
                >
                  Meeting Grid
                </h2>

                <p
                  className="pixel-mono mb-5 text-xs leading-relaxed"
                  style={{ color: '#8082b4', fontFamily: "'Space Grotesk', monospace" }}
                >
                  Video with everyone in this space who joins &mdash; full-space WebRTC mesh.
                </p>

                {/* Participants waiting banner */}
                {remoteParticipants.length > 0 ? (
                  <div
                    className="mb-4 px-3 py-2"
                    style={{
                      background: '#111827',
                      outline: '1px solid rgba(255,224,131,0.25)',
                    }}
                  >
                    <span
                      className="pixel-mono text-[9px] uppercase tracking-wider"
                      style={{ color: '#ffe083', fontFamily: "'Space Grotesk', monospace" }}
                    >
                      {remoteParticipants.length} PARTICIPANT
                      {remoteParticipants.length !== 1 ? 'S' : ''} IN MEETING
                    </span>
                  </div>
                ) : (
                  <div
                    className="mb-4 px-3 py-2"
                    style={{
                      background: '#111827',
                      outline: '1px solid rgba(192,193,255,0.15)',
                    }}
                  >
                    <span
                      className="pixel-mono text-[9px] uppercase tracking-wider"
                      style={{ color: '#8082b4', fontFamily: "'Space Grotesk', monospace" }}
                    >
                      NO PARTICIPANTS YET
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={joinMeeting}
                  className="pixel-btn w-full py-3 px-4 pixel-mono text-xs font-bold uppercase tracking-widest transition-[transform,border-bottom-width] duration-100 hover:border-b-[2px] active:translate-y-0.5 active:border-b-0"
                  style={{
                    background: 'linear-gradient(180deg,#c0c1ff 0%,#8083ff 100%)',
                    color: '#1000a9',
                    borderBottom: '4px solid #494bd6',
                    fontFamily: "'Space Grotesk', monospace",
                  }}
                >
                  Join Meeting
                </button>
              </div>

              {/* Keyboard hints */}
              <div className="mt-3 px-1">
                <p
                  className="pixel-mono text-[8px] uppercase tracking-wider leading-loose"
                  style={{ color: '#464554', fontFamily: "'Space Grotesk', monospace" }}
                >
                  [M] Mic &nbsp;&middot;&nbsp; [C] Camera &nbsp;&middot;&nbsp; Gallery / Speaker views inside
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MEETING
  // ─────────────────────────────────────────────────────────────────────────

  const cols = gridColsForCount(totalCount);

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
      style={{ background: '#0f131d' }}
    >
      {/* CRT scanline */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)',
        }}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="relative z-10 flex shrink-0 items-center justify-between px-4 py-2"
        style={{ background: '#181c26', boxShadow: '0 4px 0 0 #0a0d16' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="pixel-mono text-xs font-bold uppercase tracking-[0.25em]"
            style={{ color: '#c0c1ff', fontFamily: "'Space Grotesk', monospace" }}
          >
            SphereMeet
          </span>
          <span
            className="pixel-mono px-2 py-0.5 text-[9px] uppercase tracking-wider"
            style={{
              background: '#1e2535',
              color: '#ffe083',
              fontFamily: "'Space Grotesk', monospace",
            }}
          >
            IN_SESSION
          </span>
          {isSharing && (
            <span
              className="pixel-mono px-2 py-0.5 text-[9px] uppercase tracking-wider animate-pulse"
              style={{
                background: '#14532d',
                color: '#4ade80',
                fontFamily: "'Space Grotesk', monospace",
              }}
            >
              SHARING SCREEN
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span
            className="pixel-mono text-[9px] uppercase tracking-wider"
            style={{ color: '#8082b4', fontFamily: "'Space Grotesk', monospace" }}
          >
            {totalCount} PARTICIPANT{totalCount !== 1 ? 'S' : ''}
          </span>

          {/* View mode toggle */}
          <div className="flex" style={{ boxShadow: '2px 2px 0 0 #0a0d16' }}>
            {(['gallery', 'speaker'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className="pixel-btn px-2.5 py-1 pixel-mono text-[9px] font-bold uppercase tracking-wider"
                style={{
                  background: viewMode === mode ? '#c0c1ff' : '#1e2535',
                  color: viewMode === mode ? '#1000a9' : '#8082b4',
                  borderBottom: `2px solid ${viewMode === mode ? '#494bd6' : '#131829'}`,
                  fontFamily: "'Space Grotesk', monospace",
                }}
              >
                {mode === 'gallery' ? 'GALLERY' : 'SPEAKER'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">

        {/* Video area */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {viewMode === 'gallery' ? (
            /* ── Gallery view ─────────────────────────────────────────────── */
            <div
              className="h-full p-2"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gap: '8px',
              }}
            >
              {allParticipants.map((p) => {
                const stream = getStream(p);
                const isActive = activeSpeakerId === p.id;
                return (
                  <ParticipantTile
                    key={p.id}
                    participant={p}
                    stream={stream}
                    isActive={isActive}
                    isVideoOff={p.isSelf ? isVideoOff : false}
                    isMuted={p.isSelf ? isMuted : false}
                    isSelf={p.isSelf}
                    isPinned={pinnedUserId === p.id}
                    onPin={() =>
                      setPinnedUserId((prev) => (prev === p.id ? null : p.id))
                    }
                    onTrackAvailable={p.isSelf ? undefined : (s) => setupAudioAnalyser(p.id, s)}
                  />
                );
              })}
            </div>
          ) : (
            /* ── Speaker view ─────────────────────────────────────────────── */
            <div className="flex h-full flex-col gap-2 p-2">
              {/* Featured participant */}
              <div className="min-h-0 flex-1">
                {(() => {
                  const featured =
                    allParticipants.find((p) => p.id === featuredId) ??
                    allParticipants[0];
                  if (!featured) return null;
                  const stream = getStream(featured);
                  return (
                    <ParticipantTile
                      participant={featured}
                      stream={stream}
                      isActive
                      isVideoOff={featured.isSelf ? isVideoOff : false}
                      isMuted={featured.isSelf ? isMuted : false}
                      isSelf={featured.isSelf}
                      isPinned={pinnedUserId === featured.id}
                      large
                      onPin={() =>
                        setPinnedUserId((prev) =>
                          prev === featured.id ? null : featured.id,
                        )
                      }
                      onTrackAvailable={
                        featured.isSelf
                          ? undefined
                          : (s) => setupAudioAnalyser(featured.id, s)
                      }
                    />
                  );
                })()}
              </div>

              {/* Thumbnail strip */}
              {allParticipants.length > 1 && (
                <div
                  className="flex shrink-0 gap-2 overflow-x-auto"
                  style={{ height: '108px' }}
                >
                  {allParticipants
                    .filter((p) => p.id !== featuredId)
                    .map((p) => {
                      const stream = getStream(p);
                      return (
                        <div
                          key={p.id}
                          className="h-full shrink-0"
                          style={{ width: '160px' }}
                        >
                          <ParticipantTile
                            participant={p}
                            stream={stream}
                            isActive={activeSpeakerId === p.id}
                            isVideoOff={p.isSelf ? isVideoOff : false}
                            isMuted={p.isSelf ? isMuted : false}
                            isSelf={p.isSelf}
                            isPinned={false}
                            onPin={() => setPinnedUserId(p.id)}
                            onTrackAvailable={
                              p.isSelf
                                ? undefined
                                : (s) => setupAudioAnalyser(p.id, s)
                            }
                          />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Participants panel ────────────────────────────────────────────── */}
        {showParticipants && (
          <aside
            className="flex h-full w-60 shrink-0 flex-col"
            style={{ background: '#181c26', boxShadow: '-4px 0 0 0 #0a0d16' }}
          >
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: '2px solid #0a0d16' }}
            >
              <span
                className="pixel-mono text-[9px] font-bold uppercase tracking-wider"
                style={{ color: '#c0c1ff', fontFamily: "'Space Grotesk', monospace" }}
              >
                PARTICIPANTS ({totalCount})
              </span>
              <button
                type="button"
                onClick={() => setShowParticipants(false)}
                className="pixel-mono text-[9px] font-bold uppercase"
                style={{ color: '#8082b4' }}
              >
                [X]
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {allParticipants.map((p) => {
                const isActive = activeSpeakerId === p.id;
                const initials = p.displayName
                  .split(' ')
                  .map((n) => n[0] ?? '')
                  .join('')
                  .toUpperCase()
                  .slice(0, 2);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 px-3 py-2"
                    style={{ borderBottom: '1px solid rgba(0,0,0,0.4)' }}
                  >
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center text-[10px] font-bold"
                      style={{
                        background: '#c0c1ff',
                        color: '#1000a9',
                        fontFamily: "'Space Grotesk', monospace",
                        outline: isActive ? '2px solid #ffe083' : undefined,
                      }}
                    >
                      {initials}
                    </div>
                    <span
                      className="min-w-0 flex-1 truncate pixel-mono text-[9px] uppercase tracking-wide"
                      style={{ color: '#dfe2eb', fontFamily: "'Space Grotesk', monospace" }}
                    >
                      {p.displayName.toUpperCase().replace(/\s+/g, '_')}
                      {p.isSelf ? ' (YOU)' : ''}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      {p.isSelf && isMuted && (
                        <span
                          className="pixel-mono text-[7px] font-bold uppercase px-1"
                          style={{ background: '#b91c1c', color: '#fecaca' }}
                        >
                          M
                        </span>
                      )}
                      {p.isSelf && isVideoOff && (
                        <span
                          className="pixel-mono text-[7px] font-bold uppercase px-1"
                          style={{ background: '#b91c1c', color: '#fecaca' }}
                        >
                          V
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>

      {/* ── Control bar ────────────────────────────────────────────────────── */}
      <div
        className="relative z-10 flex shrink-0 items-center px-4 py-3"
        style={{ background: '#181c26', boxShadow: '0 -4px 0 0 #0a0d16' }}
      >
        {/* Left: Meeting info */}
        <div className="hidden w-40 items-center lg:flex">
          <span
            className="pixel-mono text-[8px] uppercase tracking-wider"
            style={{ color: '#464554', fontFamily: "'Space Grotesk', monospace" }}
          >
            SPACE_MESH &middot; {totalCount} ONLINE
          </span>
        </div>

        {/* Center: Controls */}
        <div className="flex flex-1 items-center justify-center gap-2">
          <CtrlBtn
            onClick={toggleMute}
            label={isMuted ? 'UNMUTE' : 'MUTE'}
            sublabel={isMuted ? 'mic off' : 'mic on'}
            active={!isMuted}
            danger={isMuted}
          />
          <CtrlBtn
            onClick={toggleVideo}
            label={isVideoOff ? 'START_CAM' : 'STOP_CAM'}
            sublabel={isVideoOff ? 'cam off' : 'cam on'}
            active={!isVideoOff}
            danger={isVideoOff}
          />
          <CtrlBtn
            onClick={toggleScreenShare}
            label={isSharing ? 'STOP_SHARE' : 'SHARE'}
            sublabel="screen"
            active={!isSharing}
            accent={isSharing}
          />
          <CtrlBtn
            onClick={() => setShowParticipants((s) => !s)}
            label="USERS"
            sublabel={`${totalCount} online`}
            active={!showParticipants}
            accent={showParticipants}
          />
        </div>

        {/* Right: Leave */}
        <div className="flex w-40 items-center justify-end">
          <button
            type="button"
            onClick={leaveMeeting}
            className="pixel-btn px-5 py-2 pixel-mono text-xs font-bold uppercase tracking-widest transition-[transform,border-bottom-width] duration-100 active:translate-y-0.5 active:border-b-0"
            style={{
              background: '#ef4444',
              color: '#fff',
              borderBottom: '4px solid #991b1b',
              fontFamily: "'Space Grotesk', monospace",
            }}
          >
            LEAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page shell ────────────────────────────────────────────────────────────────

export default function MeetingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[8rem] items-center justify-center bg-[var(--background)]">
          <p className="pixel-mono animate-pulse text-sm uppercase tracking-widest text-[var(--secondary)]">
            Loading&hellip;
          </p>
        </div>
      }
    >
      <MeetingsContent />
    </Suspense>
  );
}
