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
        className={`px-1 rounded ${
          isSelfMention 
            ? 'bg-yellow-500/30 text-yellow-300 font-medium' 
            : 'bg-[var(--primary)]/30 text-[var(--primary)] font-medium'
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

  const handleGoToMeet = useCallback(() => {
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
            {!isConnected && (
              <span className="px-2 py-0.5 rounded text-xs bg-yellow-600 text-white">
                Reconnecting...
              </span>
            )}
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
                    <p className="text-sm mt-0.5">
                      {renderMessageWithMentions(message.body, user?.id)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message input */}
        <div className="p-4 border-t border-[var(--border)] bg-[var(--card)] relative">
          {/* Mention autocomplete dropdown */}
          {showMentions && filteredMentionUsers.length > 0 && (
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-lg max-h-48 overflow-auto">
              <div className="p-2">
                <p className="text-xs text-[var(--muted)] px-2 py-1 mb-1">
                  Tag someone — press ↑↓ to navigate, Enter or Tab to select
                </p>
                {filteredMentionUsers.map((mentionUser, index) => (
                  <button
                    key={mentionUser.user_id}
                    type="button"
                    onClick={() => insertMention(mentionUser.display_name)}
                    onMouseEnter={() => setSelectedMentionIndex(index)}
                    className={`w-full px-3 py-2 rounded-md flex items-center gap-3 transition-colors ${
                      index === selectedMentionIndex
                        ? 'bg-[var(--primary)] text-white'
                        : 'hover:bg-[var(--card-hover)]'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                        index === selectedMentionIndex
                          ? 'bg-white/20'
                          : 'bg-[var(--border)]'
                      }`}
                    >
                      {mentionUser.display_name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                    <div className="flex-1 text-left">
                      <span className="text-sm font-medium">
                        {mentionUser.display_name}
                      </span>
                      {user?.id === mentionUser.user_id && (
                        <span className="text-xs ml-2 opacity-70">(you)</span>
                      )}
                    </div>
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={messageInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={`Message #${currentChannel} — Type @ to mention someone`}
                className="w-full px-4 py-3 rounded-lg bg-[var(--background)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)] transition-colors"
                maxLength={1000}
              />
            </div>
            <button
              type="submit"
              disabled={!messageInput.trim() || !isConnected}
              className="px-6 py-3 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-medium transition-colors disabled:opacity-50"
            >
              {isConnected ? 'Send' : 'Connecting...'}
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
