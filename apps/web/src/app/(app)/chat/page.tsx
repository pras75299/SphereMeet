'use client';

import { useEffect, useState, useRef, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStore } from '@/store';
import { useWebSocket } from '@/hooks/useWebSocket';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';

const CHANNELS = [
  { id: 'general', name: 'General', icon: '#' },
  { id: 'random', name: 'Random', icon: '#' },
  { id: 'announcements', name: 'Announcements', icon: '#' },
  { id: 'help', name: 'Help', icon: '#' },
];

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const spaceId = searchParams.get('space');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messageInput, setMessageInput] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Use individual selectors to prevent re-renders
  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const chatMessages = useStore((state) => state.chatMessages);
  const currentChannel = useStore((state) => state.currentChannel);
  const setCurrentChannel = useStore((state) => state.setCurrentChannel);
  const setChatMessages = useStore((state) => state.setChatMessages);
  const presence = useStore((state) => state.presence);

  const { sendChat } = useWebSocket(spaceId);

  // Fetch messages for current channel
  const fetchMessages = useCallback(async () => {
    if (!spaceId || !token) return;

    setLoadingMessages(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/chat/${spaceId}?channel=${currentChannel}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      if (res.ok) {
        const messages = await res.json();
        setChatMessages(currentChannel, messages);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [spaceId, token, currentChannel, setChatMessages]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Scroll to bottom when new messages arrive
  const currentMessages = useMemo(() => {
    return chatMessages.get(currentChannel) || [];
  }, [chatMessages, currentChannel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages]);

  const handleSendMessage = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;

    sendChat(currentChannel, messageInput.trim());
    setMessageInput('');
  }, [messageInput, currentChannel, sendChat]);

  const handleChannelChange = useCallback((channelId: string) => {
    setCurrentChannel(channelId);
  }, [setCurrentChannel]);

  const handleGoToMeet = useCallback(() => {
    router.push(`/activity?space=${spaceId}`);
  }, [router, spaceId]);

  const onlineUsers = useMemo(() => {
    return Array.from(presence.values());
  }, [presence]);

  return (
    <div className="h-[calc(100vh-60px)] flex">
      {/* Left sidebar - Channels */}
      <div className="w-60 bg-[var(--card)] border-r border-[var(--border)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h2 className="font-semibold text-sm text-[var(--muted)]">CHANNELS</h2>
        </div>
        <div className="flex-1 overflow-auto py-2">
          {CHANNELS.map((channel) => (
            <button
              key={channel.id}
              onClick={() => handleChannelChange(channel.id)}
              className={`w-full px-4 py-2 text-left flex items-center gap-2 transition-colors ${
                currentChannel === channel.id
                  ? 'bg-[var(--primary)] text-white'
                  : 'text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-white'
              }`}
            >
              <span className="text-lg">{channel.icon}</span>
              <span className="text-sm">{channel.name}</span>
            </button>
          ))}
        </div>

        {/* Online users section */}
        <div className="border-t border-[var(--border)]">
          <div className="p-4">
            <h2 className="font-semibold text-sm text-[var(--muted)] mb-2">
              ONLINE ({onlineUsers.length})
            </h2>
          </div>
          <div className="max-h-40 overflow-auto pb-4">
            {onlineUsers.map((userPresence) => (
              <div
                key={userPresence.user_id}
                className="px-4 py-1 flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="text-sm truncate">
                  {userPresence.display_name}
                  {user?.id === userPresence.user_id && ' (you)'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Channel header */}
        <div className="h-14 px-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--card)]">
          <div className="flex items-center gap-2">
            <span className="text-lg">#</span>
            <span className="font-semibold">
              {CHANNELS.find((c) => c.id === currentChannel)?.name || currentChannel}
            </span>
          </div>
          <button
            onClick={handleGoToMeet}
            className="px-4 py-2 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-sm font-medium transition-colors"
          >
            Meet
          </button>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loadingMessages ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-[var(--muted)]">Loading messages...</span>
            </div>
          ) : currentMessages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-[var(--muted)]">No messages yet</p>
                <p className="text-sm text-[var(--muted)]">
                  Be the first to say something!
                </p>
              </div>
            </div>
          ) : (
            currentMessages.map((message) => {
              const isSelf = user?.id === message.user_id;
              return (
                <div key={message.id} className="flex gap-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium ${
                      isSelf ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
                    }`}
                  >
                    {message.display_name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold text-sm">
                        {message.display_name}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm mt-0.5">{message.body}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message input */}
        <div className="p-4 border-t border-[var(--border)] bg-[var(--card)]">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder={`Message #${currentChannel}`}
              className="flex-1 px-4 py-3 rounded-lg bg-[var(--background)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)] transition-colors"
              maxLength={1000}
            />
            <button
              type="submit"
              disabled={!messageInput.trim()}
              className="px-6 py-3 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium transition-colors disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
      <ChatContent />
    </Suspense>
  );
}
