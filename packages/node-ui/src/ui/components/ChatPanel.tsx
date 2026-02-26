import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage } from '../api.js';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  data?: unknown;
  sparql?: string;
}

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Hi! I can help you understand your node. Ask me about uptime, peers, triples, operations, logs, or paste a SPARQL query.' },
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);
    try {
      const res = await sendChatMessage(msg);
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: res.reply,
        data: res.data,
        sparql: res.sparql,
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} title="Node Assistant">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Node Assistant</span>
        <button className="chat-close" onClick={() => setOpen(false)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/>
          </svg>
        </button>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-bubble">
              <span className="chat-msg-text" dangerouslySetInnerHTML={{ __html: formatMarkdown(m.text) }} />
              {m.sparql && (
                <details className="chat-sparql-details">
                  <summary>SPARQL used</summary>
                  <pre className="chat-sparql-code">{m.sparql}</pre>
                </details>
              )}
              {m.data && (
                <details className="chat-data-details">
                  <summary>Raw data</summary>
                  <pre className="chat-data-code">{JSON.stringify(m.data, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-bubble chat-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your node..."
          rows={1}
        />
        <button className="chat-send" onClick={send} disabled={loading || !input.trim()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1.5L15 8 1 14.5v-5L11 8 1 6.5v-5z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}
