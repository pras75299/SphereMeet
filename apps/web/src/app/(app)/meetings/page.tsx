'use client';

import { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import { useStore } from '@/store';

/** Pixel-office video room: 32px-grid inspired blocks, high-contrast (see .agent/skills/pixelart/skill.md). */

function MeetingsContent() {
  const [inMeeting, setInMeeting] = useState(false);
  const [meetingStream, setMeetingStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const user = useStore((state) => state.user);
  const presence = useStore((state) => state.presence);
  const peerConnections = useStore((state) => state.peerConnections);

  const handleJoinMeeting = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setMeetingStream(stream);
      setInMeeting(true);
    } catch (err) {
      console.error('Error accessing media devices:', err);
      alert('Could not access camera/microphone');
    }
  }, []);

  const handleLeaveMeeting = useCallback(() => {
    if (meetingStream) {
      meetingStream.getTracks().forEach((track) => track.stop());
      setMeetingStream(null);
    }
    setInMeeting(false);
    setIsMuted(false);
    setIsVideoOff(false);
  }, [meetingStream]);

  const handleToggleMute = useCallback(() => {
    if (meetingStream) {
      const audioTrack = meetingStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, [meetingStream]);

  const handleToggleVideo = useCallback(() => {
    if (meetingStream) {
      const videoTrack = meetingStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  }, [meetingStream]);

  useEffect(() => {
    return () => {
      if (meetingStream) {
        meetingStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [meetingStream]);

  const participants = useMemo(() => {
    return Array.from(presence.values()).slice(0, 5);
  }, [presence]);

  if (!inMeeting) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-[#10141a]">
        <header
          className="flex shrink-0 items-center justify-between border-b-2 border-[#464554] px-4 py-2"
          style={{ background: 'var(--surface-low)' }}
        >
          <span
            className="pixel-mono text-xs font-bold uppercase tracking-[0.25em] text-[var(--primary-lit)]"
            style={{ fontFamily: "'Share Tech Mono', monospace" }}
          >
            SphereMeet
          </span>
          <span className="flex items-center gap-2 pixel-mono text-[9px] uppercase tracking-wider text-[var(--muted)]">
            <span className="pixel-badge-on" aria-hidden />
            ready
          </span>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div
            className="pixel-frame max-w-lg w-full p-8"
            style={{
              background: '#1c2026',
              border: '2px solid #908fa0',
              boxShadow: '4px 4px 0 0 #0a0e14',
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="pixel-badge-on" />
              <p className="pixel-mono text-[10px] uppercase tracking-[0.2em] text-[#c7c4d7]">
                &gt; CONF_ROOM_LINK
              </p>
            </div>
            <h2
              className="mb-3 text-xl font-bold uppercase tracking-widest"
              style={{ fontFamily: "'Share Tech Mono', monospace", color: '#dfe2eb' }}
            >
              Meeting grid
            </h2>
            <p className="pixel-mono mb-8 text-xs leading-relaxed text-[#c7c4d7]">
              Full-space video for this office. Everyone in the meeting sees each other — no proximity limit (unlike Activity).
            </p>
            <button
              type="button"
              onClick={handleJoinMeeting}
              className="pixel-btn w-full py-3 px-4 pixel-mono text-xs font-bold uppercase tracking-widest transition-[transform,border-bottom-width] duration-100 hover:border-b-[2px] active:translate-y-0.5 active:border-b-0"
              style={{
                background: 'linear-gradient(180deg, #c0c1ff 0%, #8083ff 100%)',
                color: '#1000a9',
                borderBottom: '4px solid #494bd6',
              }}
            >
              Enter meeting
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tileClass =
    'relative overflow-hidden border-4 border-slate-950 bg-[#0d1117] shadow-[4px_4px_0_0_rgba(0,0,0,0.6)]';

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-[#10141a]">
      <header
        className="flex shrink-0 items-center justify-between border-b-2 border-[#464554] px-4 py-2"
        style={{ background: '#181c22' }}
      >
        <span
          className="pixel-mono text-xs font-bold uppercase tracking-[0.25em] text-[var(--primary-lit)]"
          style={{ fontFamily: "'Share Tech Mono', monospace" }}
        >
          SphereMeet
        </span>
        <span className="pixel-mono text-[9px] uppercase tracking-wider text-[#c7c4d7]">
          &gt; IN_SESSION
        </span>
      </header>
      <div className="min-h-0 flex-1 p-3 sm:p-4">
        <div className="mx-auto grid h-full max-w-6xl grid-cols-2 grid-rows-3 gap-3 sm:grid-cols-3 sm:grid-rows-2 sm:gap-4">
          <div className={tileClass}>
            {meetingStream && !isVideoOff ? (
              <video
                autoPlay
                muted
                playsInline
                ref={(el) => {
                  if (el && meetingStream) el.srcObject = meetingStream;
                }}
                className="h-full w-full object-cover"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#111827]">
                <div
                  className="flex h-20 w-20 items-center justify-center border-4 border-slate-950 text-lg font-bold"
                  style={{ background: 'var(--primary)', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}
                >
                  {user?.display_name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </div>
              </div>
            )}
            <div
              className="absolute bottom-0 left-0 right-0 border-t-2 border-slate-950 bg-black/75 px-2 py-1 pixel-mono text-[10px] uppercase tracking-wider text-[#dfe2eb]"
            >
              {(user?.display_name ?? 'you').toUpperCase().replace(/\s+/g, '_')} (YOU)
            </div>
            {isMuted && (
              <div className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center border-2 border-slate-950 bg-red-700">
                <span className="pixel-mono text-[10px] text-white">M</span>
              </div>
            )}
          </div>

          {participants.map((participant) => {
            if (participant.user_id === user?.id) return null;
            const peerConn = peerConnections.get(participant.user_id);
            return (
              <div key={participant.user_id} className={tileClass}>
                {peerConn?.remoteStream ? (
                  <video
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (el && peerConn.remoteStream) el.srcObject = peerConn.remoteStream;
                    }}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#1e293b]">
                    <div className="flex h-20 w-20 items-center justify-center border-4 border-slate-950 bg-slate-600 text-lg font-bold text-white" style={{ fontFamily: "'Share Tech Mono', monospace" }}>
                      {participant.display_name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 border-t-2 border-slate-950 bg-black/75 px-2 py-1 pixel-mono text-[10px] uppercase tracking-wider text-[#dfe2eb]">
                  {participant.display_name.toUpperCase().replace(/\s+/g, '_')}
                </div>
              </div>
            );
          })}

          {Array.from({ length: Math.max(0, 5 - participants.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex items-center justify-center border-4 border-dashed border-slate-700 bg-[var(--surface-low)]"
            >
              <span className="pixel-mono text-[10px] uppercase tracking-widest text-[var(--outline)]">
                empty_slot
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className="flex shrink-0 flex-wrap items-center justify-center gap-3 border-t-2 px-4 py-3"
        style={{ borderColor: 'var(--outline-dim)', background: 'var(--surface-mid)' }}
      >
        <button
          type="button"
          onClick={handleToggleMute}
          className="pixel-btn flex h-12 w-12 items-center justify-center border-2 border-slate-950"
          style={{
            background: isMuted ? '#b91c1c' : 'var(--surface-lowest)',
            color: isMuted ? '#fecaca' : 'var(--foreground)',
            borderBottom: '4px solid ' + (isMuted ? '#7f1d1d' : '#0f172a'),
          }}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          <span className="pixel-mono text-xs font-bold">{isMuted ? 'M̶' : 'MIC'}</span>
        </button>

        <button
          type="button"
          onClick={handleToggleVideo}
          className="pixel-btn flex h-12 w-12 items-center justify-center border-2 border-slate-950"
          style={{
            background: isVideoOff ? '#b91c1c' : 'var(--surface-lowest)',
            color: isVideoOff ? '#fecaca' : 'var(--foreground)',
            borderBottom: '4px solid ' + (isVideoOff ? '#7f1d1d' : '#0f172a'),
          }}
          title={isVideoOff ? 'Camera on' : 'Camera off'}
        >
          <span className="pixel-mono text-xs font-bold">{isVideoOff ? 'CAM̶' : 'CAM'}</span>
        </button>

        <button
          type="button"
          onClick={handleLeaveMeeting}
          className="pixel-btn px-6 py-2 pixel-mono text-xs font-bold uppercase tracking-widest"
          style={{
            background: '#ef4444',
            color: '#fff',
            borderBottom: '4px solid #991b1b',
          }}
        >
          Leave
        </button>
      </div>
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[8rem] items-center justify-center bg-[var(--background)]">
          <p className="pixel-mono text-sm uppercase tracking-widest text-[var(--secondary)] animate-pulse">
            Loading…
          </p>
        </div>
      }
    >
      <MeetingsContent />
    </Suspense>
  );
}
