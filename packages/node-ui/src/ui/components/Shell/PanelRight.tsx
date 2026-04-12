import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useJourneyStore } from '../../stores/journey.js';
import { type ChatAssistantStreamEvent, type MemorySession, streamChatMessage } from '../../api.js';
import { api } from '../../api-wrapper.js';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export function PanelRight() {
  const { stage, advance } = useJourneyStore();
  const [mode, setMode] = useState<'chat' | 'sessions'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [sessions, setSessions] = useState<MemorySession[]>([]);
  const msgIdRef = useRef(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  const loadSessions = useCallback(() => {
    api.fetchMemorySessions(20)
      .then(({ sessions: s }: any) => setSessions(s))
      .catch(() => {});
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { id: ++msgIdRef.current, role: 'user', content: text };
    const assistantMsg: ChatMessage = { id: ++msgIdRef.current, role: 'assistant', content: '', streaming: true };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setSending(true);

    const assistantId = assistantMsg.id;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await streamChatMessage(text, {
        sessionId,
        signal: controller.signal,
        onEvent: (event: ChatAssistantStreamEvent) => {
          if (event.type === 'text_delta') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + event.delta } : m
              )
            );
          } else if (event.type === 'meta' && event.sessionId) {
            setSessionId(event.sessionId);
          }
        },
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: res.reply || m.content, streaming: false }
            : m
        )
      );

      if (res.sessionId) setSessionId(res.sessionId);
      if (stage === 0) advance();
      loadSessions();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `Error: ${err.message}`, streaming: false }
              : m
          )
        );
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [input, sending, sessionId, stage, advance, loadSessions]);

  const openSession = useCallback((session: MemorySession) => {
    const mapped: ChatMessage[] = session.messages.map((m, i) => ({
      id: ++msgIdRef.current,
      role: m.author === 'user' ? 'user' as const : 'assistant' as const,
      content: m.text,
    }));
    setMessages(mapped);
    setSessionId(session.session);
    setMode('chat');
  }, []);

  return (
    <div className="v10-panel-right">
      <div className="v10-agent-mode-tabs">
        <button
          className={`v10-agent-mode-tab ${mode === 'chat' ? 'active' : ''}`}
          onClick={() => setMode('chat')}
        >
          Chat
        </button>
        <button
          className={`v10-agent-mode-tab ${mode === 'sessions' ? 'active' : ''}`}
          onClick={() => setMode('sessions')}
        >
          Sessions
        </button>
      </div>

      {mode === 'chat' && (
        <>
          <div className="v10-agent-content">
            {messages.length === 0 && stage === 0 && (
              <div className="v10-agent-onboarding">
                <div className="v10-agent-onboarding-title">Connect an Agent</div>
                <p className="v10-agent-onboarding-desc">
                  Connect your AI agent to the DKG to unlock shared, verifiable memory.
                </p>
                <div className="v10-agent-connect-cards">
                  <button className="v10-agent-connect-card">
                    <span className="v10-agent-connect-card-name">OpenClaw</span>
                    <span className="v10-agent-connect-card-desc">Claude Code / MCP</span>
                  </button>
                  <button className="v10-agent-connect-card">
                    <span className="v10-agent-connect-card-name">Hermes</span>
                    <span className="v10-agent-connect-card-desc">Hermes Agora node</span>
                  </button>
                  <button className="v10-agent-connect-card">
                    <span className="v10-agent-connect-card-name">ElizaOS</span>
                    <span className="v10-agent-connect-card-desc">ElizaOS adapter</span>
                  </button>
                </div>
              </div>
            )}
            {messages.length === 0 && stage >= 1 && (
              <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
                Ask your agent a question to get started.
              </div>
            )}
            <div className="v10-chat-messages">
              {messages.map((m) => (
                <div key={m.id} className={`v10-chat-msg ${m.role}`}>
                  <div className={`v10-chat-bubble ${m.role}`}>
                    {m.content}
                    {m.streaming && <span className="v10-chat-cursor" />}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>

          <div className="v10-agent-input-area">
            <input
              type="text"
              placeholder="Ask your agent..."
              className="v10-agent-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={sending}
            />
            <button className="v10-agent-send-btn" onClick={send} disabled={sending || !input.trim()}>
              ↑
            </button>
          </div>
        </>
      )}

      {mode === 'sessions' && (
        <div className="v10-agent-content">
          <div className="v10-sessions-list">
            {sessions.length === 0 ? (
              <p style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center' }}>
                No sessions yet
              </p>
            ) : (
              sessions.map((s) => {
                const preview = s.messages?.[0]?.text?.slice(0, 60) || s.session;
                const count = s.messages?.length ?? 0;
                return (
                  <button
                    key={s.session}
                    className="v10-session-item"
                    onClick={() => openSession(s)}
                  >
                    <span className="v10-session-preview">{preview}</span>
                    <span className="v10-session-count">{count} msg{count !== 1 ? 's' : ''}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
