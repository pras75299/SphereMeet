'use client';

import { useEffect, useState, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStore } from '@/store';
import { useWebSocket } from '@/hooks/useWebSocket';

function MeetingsContent() {
  const searchParams = useSearchParams();
  const spaceId = searchParams.get('space');
  const [inMeeting, setInMeeting] = useState(false);
  const [meetingStream, setMeetingStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  // Use individual selectors to prevent re-renders
  const user = useStore((state) => state.user);
  const presence = useStore((state) => state.presence);
  const peerConnections = useStore((state) => state.peerConnections);

  // Initialize WebSocket connection
  useWebSocket(spaceId);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (meetingStream) {
        meetingStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [meetingStream]);

  // Get participants (for demo, show presence users)
  const participants = useMemo(() => {
    return Array.from(presence.values()).slice(0, 5);
  }, [presence]);

  if (!inMeeting) {
    return (
      <div className="h-[calc(100vh-60px)] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Meeting Room</h2>
          <p className="text-[var(--muted)] mb-8 max-w-md">
            Join a video meeting with all participants in this space. 
            Unlike Activity mode, everyone in the meeting can see and hear each other 
            regardless of proximity.
          </p>
          <button
            onClick={handleJoinMeeting}
            className="px-8 py-4 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium text-lg transition-colors"
          >
            Join Meeting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-60px)] flex flex-col bg-[var(--background)]">
      {/* Video grid - 2x3 layout */}
      <div className="flex-1 p-4">
        <div className="h-full grid grid-cols-3 grid-rows-2 gap-4 max-w-6xl mx-auto">
          {/* Self video */}
          <div className="relative rounded-xl overflow-hidden bg-[var(--card)] border border-[var(--border)]">
            {meetingStream && !isVideoOff ? (
              <video
                autoPlay
                muted
                playsInline
                ref={(el) => {
                  if (el && meetingStream) {
                    el.srcObject = meetingStream;
                  }
                }}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-24 h-24 rounded-full bg-[var(--primary)] flex items-center justify-center text-3xl font-bold">
                  {user?.display_name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </div>
              </div>
            )}
            <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/50 text-sm">
              {user?.display_name} (You)
            </div>
            {isMuted && (
              <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-red-500 flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              </div>
            )}
          </div>

          {/* Other participants */}
          {participants.map((participant) => {
            if (participant.user_id === user?.id) return null;
            const peerConn = peerConnections.get(participant.user_id);
            
            return (
              <div
                key={participant.user_id}
                className="relative rounded-xl overflow-hidden bg-[var(--card)] border border-[var(--border)]"
              >
                {peerConn?.remoteStream ? (
                  <video
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (el && peerConn.remoteStream) {
                        el.srcObject = peerConn.remoteStream;
                      }
                    }}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-24 h-24 rounded-full bg-[var(--border)] flex items-center justify-center text-3xl font-bold">
                      {participant.display_name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                  </div>
                )}
                <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/50 text-sm">
                  {participant.display_name}
                </div>
              </div>
            );
          })}

          {/* Empty slots */}
          {Array.from({ length: Math.max(0, 5 - participants.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="rounded-xl bg-[var(--card)] border border-[var(--border)] border-dashed flex items-center justify-center"
            >
              <span className="text-[var(--muted)] text-sm">Empty</span>
            </div>
          ))}
        </div>
      </div>

      {/* Meeting controls */}
      <div className="h-20 bg-[var(--card)] border-t border-[var(--border)] flex items-center justify-center gap-4">
        <button
          onClick={handleToggleMute}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
            isMuted
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-[var(--border)] hover:bg-[var(--card-hover)]'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          )}
        </button>

        <button
          onClick={handleToggleVideo}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
            isVideoOff
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-[var(--border)] hover:bg-[var(--card-hover)]'
          }`}
          title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
        >
          {isVideoOff ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </button>

        <button
          onClick={handleLeaveMeeting}
          className="px-8 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white font-medium transition-colors"
        >
          Leave Meeting
        </button>
      </div>
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
      <MeetingsContent />
    </Suspense>
  );
}
