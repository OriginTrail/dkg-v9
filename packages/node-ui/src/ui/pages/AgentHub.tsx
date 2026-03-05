import React, { useState, useEffect, useRef } from 'react';
import { useFetch } from '../hooks.js';
import { fetchStatus } from '../api.js';

interface ChatMessage { role: 'user' | 'assistant'; text: string; tool?: string; }

const INITIAL_MESSAGES: ChatMessage[] = [
  { role: 'assistant', text: "Hello! I'm your DKG Agent. I can publish Knowledge Assets, query the graph, and verify provenance. What would you like to do?" },
];

const MCP_CLIENTS = [
  { client: 'Cursor IDE', status: 'connected', calls: 47 },
  { client: 'Claude Desktop', status: 'connected', calls: 12 },
  { client: 'Custom Agent', status: 'idle', calls: 0 },
];

const PLUGINS = ['dkg-publish', 'dkg-query', 'dkg-verify', 'oregon-trail'];

export function AgentHubPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { data: status } = useFetch(fetchStatus, [], 15_000);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `I found 3 Knowledge Assets related to "${text}". The most relevant was published 2 hours ago with a HIGH trust score — verified by 3 independent sources.`,
        tool: 'dkg-knowledge-asset-search',
      }]);
    }, 800);
  }

  return (
    <div className="page-section" style={{ paddingBottom: 0 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 className="page-title">Agent Hub</h2>
        <p className="page-subtitle">Chat with your local DKG agent, manage MCP connections, and configure plugins</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, height: 'calc(100vh - 180px)' }}>

        {/* Chat */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="chat-area">
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.tool && <div className="chat-tool">⚡ Tool: {m.tool}</div>}
                <div className={`chat-bubble ${m.role}`}>{m.text}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="chat-input-row">
            <input
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask your DKG agent anything…"
            />
            <button className="chat-send" onClick={send}>Send</button>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>

          {/* Agent Identity */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Agent Identity</div>
            <div className="mono" style={{ fontSize: 10, marginBottom: 4, wordBreak: 'break-all' }}>did:dkg:agent:0x7a3f…b2e9</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>
              {(status as any)?.totalTriples ?? 142} Knowledge Assets published
            </div>
            <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--green-dim)', border: '1px solid rgba(74,222,128,0.13)', fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>
              Reputation: ESTABLISHED
            </div>
          </div>

          {/* MCP Connections */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>MCP Connections</div>
            {MCP_CLIENTS.map(c => (
              <div key={c.client} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.status === 'connected' ? 'var(--green)' : 'var(--text-dim)', display: 'inline-block' }} />
                  <span style={{ fontWeight: 500 }}>{c.client}</span>
                </div>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{c.calls} calls</span>
              </div>
            ))}
          </div>

          {/* Plugins */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Plugins</div>
            {PLUGINS.map(p => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', fontSize: 11 }}>
                <span className="mono">{p}</span>
                <span style={{ width: 28, height: 16, borderRadius: 8, background: 'var(--green)', display: 'flex', alignItems: 'center', padding: '0 2px', justifyContent: 'flex-end' }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'white', display: 'inline-block' }} />
                </span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
