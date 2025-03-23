'use client';

import { useEffect, useState, useRef, useCallback, Suspense, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useStore } from '@/store';
import { useWebSocketContext } from '@/hooks/WebSocketProvider';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';

const CHANNELS = [
  { id: 'general', name: 'General', icon: '#' },
  { id: 'random', name: 'Random', icon: '#' },
  { id: 'announcements', name: 'Announcements', icon: '#' },
  { id: 'help', name: 'Help', icon: '#' },
];

// Helper function to parse message body and render mentions with highlighting
function renderMessageWithMentions(body: string, currentUserId?: string) {
  // Match @username patterns (alphanumeric, spaces allowed within the mention)
  const mentionRegex = /@([a-zA-Z0-9_\s]+?)(?=\s@|\s|$|[.,!?])/g;
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(body)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }
    
    const mentionedName = match[1].trim();
    const isSelfMention = currentUserId && mentionedName.toLowerCase() === 'you';
    
    // Add the highlighted mention
    parts.push(
      <span
        key={match.index}
        className={`px-1 ${
          isSelfMention
            ? 'bg-yellow-500/30 text-yellow-300 font-medium'
            : 'bg-[var(--primary)]/30 text-[var(--primary-lit)] font-medium'
        }`}
      >
        @{mentionedName}
      </span>
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text after last mention
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : body;
}

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const spaceId = searchParams.get('space');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [messageInput, setMessageInput] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  
  // Mention autocomplete state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  // Use individual selectors to prevent re-renders
  const token = useStore((state) => state.token);
  const user = useStore((state) => state.user);
  const chatMessages = useStore((state) => state.chatMessages);
  const currentChannel = useStore((state) => state.currentChannel);
  const setCurrentChannel = useStore((state) => state.setCurrentChannel);
  const setChatMessages = useStore((state) => state.setChatMessages);
  const presence = useStore((state) => state.presence);

  const { sendChat, isConnected } = useWebSocketContext();

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
    if (!messageInput.trim() || !isConnected) return;

    const sent = sendChat(currentChannel, messageInput.trim());
    if (sent) {
      setMessageInput('');
    }
  }, [messageInput, currentChannel, sendChat, isConnected]);

  const handleChannelChange = useCallback((channelId: string) => {
    setCurrentChannel(channelId);
  }, [setCurrentChannel]);

  const handleGoToActivity = useCallback(() => {
    router.push(`/activity?space=${spaceId}`);
  }, [router, spaceId]);

  const onlineUsers = useMemo(() => {
    return Array.from(presence.values());
  }, [presence]);

  // Filter users for mention autocomplete
  const filteredMentionUsers = useMemo(() => {
    if (!showMentions) return [];
    const query = mentionQuery.toLowerCase();
    return onlineUsers.filter(
      (u) => u.display_name.toLowerCase().includes(query)
    );
  }, [showMentions, mentionQuery, onlineUsers]);

  // Reset selected index when filtered users change
  useEffect(() => {
    setSelectedMentionIndex(0);
  }, [filteredMentionUsers.length]);

  // Handle input change with mention detection
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart || 0;
    setMessageInput(value);

    // Find if we're in a mention context (@ followed by characters, no space completing it)
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's no space after @ (still typing the mention)
      if (!textAfterAt.includes(' ') || textAfterAt.split(' ').length <= 2) {
        // Only show mentions if the query part doesn't have more than one space
        const queryPart = textAfterAt.split(' ').slice(0, 2).join(' ');
        if (queryPart.length <= 30) {
          setShowMentions(true);
          setMentionQuery(queryPart);
          setMentionStartIndex(lastAtIndex);
          return;
        }
      }
    }
    
    setShowMentions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
  }, []);

  // Insert mention into input
  const insertMention = useCallback((displayName: string) => {
    if (mentionStartIndex === -1) return;
    
    const beforeMention = messageInput.slice(0, mentionStartIndex);
    const afterMention = messageInput.slice(
      mentionStartIndex + 1 + mentionQuery.length
    );
    
    const newValue = `${beforeMention}@${displayName} ${afterMention}`;
    setMessageInput(newValue);
    setShowMentions(false);
    setMentionQuery('');
    setMentionStartIndex(-1);
    
    // Focus back on input
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [messageInput, mentionStartIndex, mentionQuery]);

  // Handle keyboard navigation for mentions
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showMentions || filteredMentionUsers.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedMentionIndex((prev) => 
          prev < filteredMentionUsers.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedMentionIndex((prev) => 
          prev > 0 ? prev - 1 : filteredMentionUsers.length - 1
        );
        break;
      case 'Enter':
        if (showMentions && filteredMentionUsers[selectedMentionIndex]) {
          e.preventDefault();
          insertMention(filteredMentionUsers[selectedMentionIndex].display_name);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowMentions(false);
        break;
      case 'Tab':
        if (filteredMentionUsers[selectedMentionIndex]) {
          e.preventDefault();
          insertMention(filteredMentionUsers[selectedMentionIndex].display_name);
        }
        break;
    }
  }, [showMentions, filteredMentionUsers, selectedMentionIndex, insertMention]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 bg-[#10141a]">
      {/* Channel rail — Stitch “Chat Mode Terminal” */}
      <aside
        className="flex w-52 shrink-0 flex-col border-r-2 sm:w-[240px]"
        style={{ borderColor: '#464554', background: '#1c2026' }}
      >
        <div className="border-b-2 px-3 py-3" style={{ borderColor: '#464554' }}>
          <h2 className="pixel-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#c7c4d7]">
            &gt; CHANNELS
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {CHANNELS.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => handleChannelChange(channel.id)}
              className="pixel-mono flex w-full items-center gap-2 px-3 py-2 text-left text-xs uppercase tracking-wider transition-colors duration-100"
              style={{
                background: currentChannel === channel.id ? 'linear-gradient(180deg, #c0c1ff 0%, #8083ff 100%)' : 'transparent',
                color: currentChannel === channel.id ? '#1000a9' : '#c7c4d7',
                borderBottom: currentChannel === channel.id ? '2px solid #494bd6' : '2px solid transparent',
              }}
            >
              <span className={currentChannel === channel.id ? 'text-[#1000a9]' : 'text-[#ffb95f]'}>#</span>
              <span>{channel.id}</span>
            </button>
          ))}
        </div>

        <div className="border-t-2" style={{ borderColor: '#464554' }}>
          <div className="px-3 py-2">
            <p className="pixel-mono text-[10px] font-bold uppercase tracking-widest text-[#c7c4d7]">
              &gt; ONLINE ({onlineUsers.length})
            </p>
          </div>
          <div className="max-h-36 overflow-y-auto pb-2">
            {onlineUsers.map((userPresence) => (
              <div
                key={userPresence.user_id}
                className="flex items-center gap-2 px-3 py-1 pixel-mono text-[10px] text-[var(--foreground)]"
              >
                <span className="pixel-badge-on shrink-0" aria-hidden />
                <span className="truncate uppercase tracking-wide">
                  {userPresence.display_name}
                  {user?.id === userPresence.user_id && ' (you)'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className="flex shrink-0 items-center justify-between gap-2 border-b-2 px-3 py-2 sm:px-4"
          style={{ borderColor: '#464554', background: '#181c22' }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="pixel-mono text-[#ffb95f]">#</span>
            <span
              className="truncate font-bold uppercase tracking-widest pixel-mono text-xs sm:text-sm"
              style={{ color: '#dfe2eb', fontFamily: "'Share Tech Mono', monospace" }}
            >
              {currentChannel}
            </span>
            {!isConnected && (
              <span
                className="shrink-0 pixel-mono px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{ background: '#ee9800', color: '#2a1700', border: '2px solid #ffb95f' }}
              >
                WS DISCONNECTED
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleGoToActivity}
            className="pixel-btn shrink-0 px-3 py-1.5 pixel-mono text-[10px] font-bold uppercase tracking-widest"
            style={{
              background: 'linear-gradient(180deg, #c0c1ff 0%, #8083ff 100%)',
              color: '#1000a9',
              borderBottom: '3px solid #494bd6',
            }}
          >
            Map
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" style={{ background: '#10141a' }}>
          {loadingMessages ? (
            <div className="flex h-full items-center justify-center">
              <span className="pixel-mono text-xs uppercase tracking-widest text-[var(--muted)] animate-pulse">
                Loading_log…
              </span>
            </div>
          ) : currentMessages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div
                className="max-w-sm p-8 text-center"
                style={{
                  background: '#0a0e14',
                  border: '2px dashed #464554',
                }}
              >
                <p className="pixel-mono text-xs uppercase tracking-widest text-[#c7c4d7]">
                  &gt; NO_MESSAGES
                </p>
                <p className="mt-3 pixel-mono text-[10px] text-[#908fa0]">
                  Open channel — type below to transmit
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {currentMessages.map((message) => {
                const isSelf = user?.id === message.user_id;
                return (
                  <div
                    key={message.id}
                    className="flex gap-3 border-2 p-2 sm:p-3"
                    style={{
                      borderColor: '#908fa0',
                      background: isSelf ? 'rgba(192,193,255,0.12)' : '#1c2026',
                    }}
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-slate-950 text-xs font-bold"
                      style={{
                        background: isSelf ? 'var(--primary)' : '#334155',
                        color: '#fff',
                        fontFamily: "'Share Tech Mono', monospace",
                      }}
                    >
                      {message.display_name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-baseline gap-2">
                        <span className="pixel-mono text-xs font-bold uppercase tracking-wide text-[var(--secondary-lit)]">
                          {message.display_name}
                        </span>
                        <span className="pixel-mono text-[10px] text-[var(--outline)]">
                          {new Date(message.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="pixel-mono text-sm leading-relaxed text-[var(--foreground)]">
                        {renderMessageWithMentions(message.body, user?.id)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div
          className="relative shrink-0 border-t-2 p-3 sm:p-4"
          style={{ borderColor: '#464554', background: '#0a0e14' }}
        >
          {showMentions && filteredMentionUsers.length > 0 && (
            <div
              className="absolute bottom-full left-3 right-3 mb-2 max-h-48 overflow-y-auto border-2 shadow-lg sm:left-4 sm:right-4"
              style={{
                borderColor: 'var(--outline-dim)',
                background: 'var(--surface-mid)',
                boxShadow: '6px 6px 0 0 rgba(0,0,0,0.35)',
              }}
            >
              <div className="p-2">
                <p className="mb-2 px-2 pixel-mono text-[9px] uppercase tracking-wider text-[var(--muted)]">
                  @mention — ↑↓ Enter Tab
                </p>
                {filteredMentionUsers.map((mentionUser, index) => (
                  <button
                    key={mentionUser.user_id}
                    type="button"
                    onClick={() => insertMention(mentionUser.display_name)}
                    onMouseEnter={() => setSelectedMentionIndex(index)}
                    className="flex w-full items-center gap-2 border-2 border-transparent px-2 py-2 text-left transition-colors"
                    style={{
                      background: index === selectedMentionIndex ? 'var(--primary)' : 'transparent',
                      color: index === selectedMentionIndex ? '#fff' : 'var(--foreground)',
                      borderColor: index === selectedMentionIndex ? '#312e81' : 'transparent',
                    }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-slate-950 text-[10px] font-bold"
                      style={{
                        background: index === selectedMentionIndex ? 'rgba(255,255,255,0.2)' : '#475569',
                        color: '#fff',
                      }}
                    >
                      {mentionUser.display_name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                    <span className="pixel-mono text-xs uppercase tracking-wide">
                      {mentionUser.display_name}
                      {user?.id === mentionUser.user_id && ' (you)'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            onSubmit={handleSendMessage}
            className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center">
              <span className="shrink-0 pixel-mono text-[10px] font-bold uppercase tracking-wider text-[#c7c4d7] sm:mr-1">
                &gt; MSG:
              </span>
              <div className="relative min-w-0 flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={messageInput}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={`#${currentChannel} — @mention`}
                  className="w-full px-3 py-2.5 pixel-mono text-sm text-[#dfe2eb] placeholder:text-[#908fa0] focus:border-b-2 focus:border-[#c0c1ff]"
                  style={{
                    background: '#0a0e14',
                    border: '2px solid #464554',
                    borderBottom: '2px solid #8083ff',
                    borderRadius: 0,
                    outline: 'none',
                  }}
                  maxLength={1000}
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={!messageInput.trim() || !isConnected}
              className="pixel-btn shrink-0 px-5 py-2.5 pixel-mono text-xs font-bold uppercase tracking-widest transition-[transform,border-bottom-width] duration-100 disabled:opacity-50 hover:border-b-[2px] active:translate-y-0.5 active:border-b-0"
              style={{
                background: 'linear-gradient(180deg, #c0c1ff 0%, #8083ff 100%)',
                color: '#1000a9',
                borderBottom: '4px solid #494bd6',
              }}
            >
              {isConnected ? 'Send' : 'Wait…'}
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
