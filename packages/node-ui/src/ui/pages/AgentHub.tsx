import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendChatMessage, fetchMemorySessions, type MemorySession } from '../api.js';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  data?: unknown;
  sparql?: string;
}

const INITIAL: Message[] = [
  {
    id: 0,
    role: 'assistant',
    content: 'Agent online. Connected to DKG v9 testnet with access to your Knowledge Assets. How can I help?',
    ts: 'just now',
  },
];

const AGENT_TOOLS = [
  'dkg:query', 'dkg:publish', 'dkg:verify',
  'memory:recall', 'memory:store', 'graph:traverse',
];

let _mid = 10;

/** Format a date string for display; return original string or '—' if invalid. */
function formatDate(ts: string | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!ts || typeof ts !== 'string') return '—';
  const trimmed = ts.replace(/\^\^<[^>]+>$/, '').trim().replace(/^"|"$/g, '');
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed || '—';
  return date.toLocaleDateString(undefined, options ?? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AgentHubPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>(INITIAL);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showMemories, setShowMemories] = useState(false);
  const [sessions, setSessions] = useState<MemorySession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMsg: Message = { id: _mid++, role: 'user', content: text, ts: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await sendChatMessage(text);
      setMessages(prev => [...prev, {
        id: _mid++,
        role: 'assistant',
        content: res.reply,
        ts: new Date().toLocaleTimeString(),
        data: res.data,
        sparql: res.sparql,
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: _mid++,
        role: 'assistant',
        content: `Error: ${err.message}`,
        ts: new Date().toLocaleTimeString(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const loadMemories = useCallback(async () => {
    setShowMemories(true);
    setSessionsLoading(true);
    try {
      const res = await fetchMemorySessions(30);
      setSessions(res.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadSession = useCallback((session: MemorySession) => {
    const restored: Message[] = session.messages.map((m) => ({
      id: _mid++,
      role: m.author === 'user' ? 'user' as const : 'assistant' as const,
      content: m.text,
      ts: m.ts ? new Date(m.ts).toLocaleTimeString() : '',
    }));
    setMessages(restored);
    setShowMemories(false);
  }, []);

  const visualizeSession = useCallback((session: MemorySession) => {
    const safeId = encodeURIComponent(session.session).replace(/%/g, '');
    const sessionUri = `urn:dkg:chat:session:${safeId}`;
    const sparql = `CONSTRUCT { ?s ?p ?o } WHERE { ?s <http://schema.org/isPartOf> <${sessionUri}> . ?s ?p ?o } LIMIT 5000`;
    navigate(`/explorer/sparql?q=${encodeURIComponent(sparql)}`);
  }, [navigate]);

  const rightPanel = (
    <div style={{ overflowY: 'auto', padding: '20px 18px' }}>
      {!showMemories ? (
        <button
          onClick={loadMemories}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          View Memories
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <button onClick={() => setShowMemories(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Previous conversations</span>
          </div>
          {sessionsLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>Loading…</div>}
          {!sessionsLoading && sessions.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: 12 }}>No conversations yet. Chats with your agent are stored here.</div>
          )}
          {sessions.map((s, i) => {
            const first = s.messages.find(m => m.author === 'user');
            const preview = first?.text?.slice(0, 50) || 'Empty';
            const lastTs = s.messages[s.messages.length - 1]?.ts;
            const dateLabel = formatDate(lastTs);
            return (
              <div key={s.session || i} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 8, background: 'var(--surface)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}{preview.length >= 50 ? '…' : ''}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 8 }}>{s.messages.length} msg{dateLabel && ` · ${dateLabel}`}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => loadSession(s)} style={{ flex: 1, padding: '5px 8px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer' }}>Load</button>
                  <button onClick={() => visualizeSession(s)} style={{ flex: 1, padding: '5px 8px', fontSize: 10, fontWeight: 600, borderRadius: 6, border: '1px solid rgba(74,222,128,.3)', background: 'var(--green-dim)', color: 'var(--green)', cursor: 'pointer' }}>Visualize</button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <div className="page-section" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', height: '100%', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--green-dim)', border: '1px solid rgba(74,222,128,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🤖</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>DKG Agent</div>
              <div style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
                Connected
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {AGENT_TOOLS.slice(0, 3).map(t => (
                <span key={t} className="mono" style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{t}</span>
              ))}
            </div>
          </div>

          <div className="chat-area" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {messages.map(m => (
              <div key={m.id} className={`chat-msg ${m.role}`}>
                <div className={`chat-bubble ${m.role}`}>{m.content}</div>
                {m.sparql && (
                  <details style={{ marginTop: 4 }}>
                    <summary style={{ fontSize: 10, color: 'var(--text-dim)', cursor: 'pointer' }}>SPARQL used</summary>
                    <pre className="mono" style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 8px', background: 'var(--surface)', borderRadius: 4, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{m.sparql}</pre>
                  </details>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>{m.ts}</div>
              </div>
            ))}
            {loading && (
              <div className="chat-msg assistant">
                <div className="chat-bubble assistant" style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '12px 16px' }}>
                  {[0, 0.2, 0.4].map((d, i) => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-muted)', display: 'inline-block', animation: `pulse 1.2s ease ${d}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="chat-input-row">
            <input
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Query the graph, recall memories, publish knowledge…"
            />
            <button className="chat-send" onClick={send} disabled={loading}>Send</button>
          </div>
        </div>

        {rightPanel}
      </div>
    </div>
  );
}
