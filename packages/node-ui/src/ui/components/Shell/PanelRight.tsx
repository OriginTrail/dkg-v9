import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useJourneyStore } from '../../stores/journey.js';
import {
  type ChatAssistantStreamEvent,
  type LocalAgentIntegration,
  type LocalAgentHistoryMessage,
  type LocalAgentStreamEvent,
  type MemorySession,
  connectLocalAgentIntegration,
  fetchAgents,
  fetchConnections,
  fetchLocalAgentHistory,
  fetchLocalAgentIntegrations,
  streamChatMessage,
  streamLocalAgentChat,
} from '../../api.js';
import { api } from '../../api-wrapper.js';

interface AssistantMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface LocalAgentMessage {
  id: string;
  uri?: string;
  turnId?: string;
  role: 'user' | 'assistant';
  content: string;
  ts?: string;
  streaming?: boolean;
}

interface AgentInfo {
  agentUri: string;
  name: string;
  peerId: string;
  framework?: string;
  nodeRole?: string;
  connectionStatus?: string;
  connectionTransport?: string;
  connectionDirection?: string;
  lastSeen?: number;
  latencyMs?: number;
}

const OPENCLAW_DOCS_URL = 'https://docs.openclaw.ai/';
const OPENCLAW_RELEASE_URL = 'https://github.com/openclaw/openclaw/releases/tag/v2026.4.12';

let localMessageId = 0;

function shortPeerId(peerId: string): string {
  return peerId.length > 12 ? peerId.slice(-8) : peerId;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatLocalTimestamp(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mapHistoryMessage(message: LocalAgentHistoryMessage): LocalAgentMessage {
  const author = message.author.toLowerCase();
  return {
    id: message.uri || `local-history:${++localMessageId}`,
    uri: message.uri,
    turnId: message.turnId,
    role: author.includes('assistant') || author.includes('agent') ? 'assistant' : 'user',
    content: message.text,
    ts: formatLocalTimestamp(message.ts),
  };
}

function localMessageKey(message: LocalAgentMessage): string {
  return message.turnId
    ? `turn:${message.turnId}:${message.role}`
    : message.uri
    ?? `${message.role}:${message.ts ?? ''}:${message.content}`;
}

function mergeLocalAgentMessages(existing: LocalAgentMessage[], incoming: LocalAgentMessage[]): LocalAgentMessage[] {
  const seen = new Set<string>();
  const merged: LocalAgentMessage[] = [];
  for (const message of [...incoming, ...existing]) {
    const key = localMessageKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  return merged;
}

function ConnectedAgentsTab(props: {
  integrations: LocalAgentIntegration[];
  selectedIntegrationId: string;
  onSelectIntegration: (id: string) => void;
  onConnectIntegration: (id: string) => void;
  onRefreshIntegrations: () => void;
  connectBusyId: string | null;
  connectNotice: string | null;
  connectError: string | null;
  localMessages: LocalAgentMessage[];
  localHistoryLoaded: boolean;
  localChatEndRef: React.RefObject<HTMLDivElement | null>;
  localInput: string;
  onLocalInputChange: (value: string) => void;
  onSendLocalMessage: () => void;
  localSending: boolean;
  peerAgents: AgentInfo[];
  connections: { total: number; direct: number; relayed: number };
  loading: boolean;
}) {
  const {
    integrations,
    selectedIntegrationId,
    onSelectIntegration,
    onConnectIntegration,
    onRefreshIntegrations,
    connectBusyId,
    connectNotice,
    connectError,
    localMessages,
    localHistoryLoaded,
    localChatEndRef,
    localInput,
    onLocalInputChange,
    onSendLocalMessage,
    localSending,
    peerAgents,
    connections,
    loading,
  } = props;

  const selected = integrations.find((item) => item.id === selectedIntegrationId) ?? integrations[0] ?? null;
  const readyCount = integrations.filter((item) => item.chatReady).length;

  return (
    <div className="v10-agents-tab">
      <div className="v10-agents-summary">
        <span className="v10-agents-stat">
          <span className={`v10-agents-stat-dot ${readyCount > 0 ? 'connected' : 'known'}`} />
          {readyCount} chat-ready
        </span>
        <span className="v10-agents-stat">
          {connections.total} peer{connections.total !== 1 ? 's' : ''}
        </span>
        <button className="v10-agents-refresh" onClick={onRefreshIntegrations} title="Refresh local agent status">
          Refresh
        </button>
      </div>

      <div className="v10-agents-section-label">Connected Agent Chat</div>
      <div className="v10-local-agent-list" role="tablist" aria-label="Local agent integrations">
        {integrations.map((integration) => (
          <button
            key={integration.id}
            className={`v10-local-agent-card ${selected?.id === integration.id ? 'active' : ''}`}
            onClick={() => onSelectIntegration(integration.id)}
            role="tab"
            aria-selected={selected?.id === integration.id}
          >
            <div className="v10-local-agent-card-head">
              <span className={`v10-agent-card-dot ${integration.chatReady ? 'connected' : integration.status === 'coming_soon' ? 'known' : 'self'}`} />
              <span className="v10-agent-card-name">{integration.name}</span>
              <span className={`v10-local-agent-badge ${integration.status}`}>
                {integration.statusLabel}
              </span>
            </div>
            <div className="v10-agent-card-meta">
              <span>{integration.framework}</span>
              <span>{integration.detail}</span>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="v10-local-agent-detail">
          <div className="v10-local-agent-detail-head">
            <div>
              <div className="v10-local-agent-title">{selected.name}</div>
              <div className="v10-local-agent-subtitle">{selected.description}</div>
            </div>
            <span className={`v10-local-agent-status-pill ${selected.status}`}>
              {selected.statusLabel}
            </span>
          </div>

          {connectNotice && <div className="v10-local-agent-notice">{connectNotice}</div>}
          {connectError && <div className="v10-local-agent-error">{connectError}</div>}

          {selected.chatSupported && selected.chatReady ? (
            <>
              <div className="v10-local-agent-chat-meta">
                <span>Messages stay anchored in your private DKG memory graph until you choose to publish.</span>
                <span>{selected.target === 'gateway' ? 'Gateway bridge live' : 'Local bridge live'}</span>
              </div>
              <div className="v10-chat-messages v10-local-agent-messages">
                {!localHistoryLoaded && localMessages.length === 0 && (
                  <div className="v10-agent-empty-state">
                    Loading the latest conversation from DKG memory...
                  </div>
                )}
                {localHistoryLoaded && localMessages.length === 0 && (
                  <div className="v10-agent-empty-state">
                    Send a message to start chatting with your connected {selected.name} agent.
                  </div>
                )}
                {localMessages.map((message) => (
                  <div key={message.id} className={`v10-chat-msg ${message.role}`}>
                    <div className={`v10-chat-bubble ${message.role}`}>
                      {message.content}
                      {message.streaming && <span className="v10-chat-cursor" />}
                    </div>
                    {message.ts && (
                      <span className={`v10-local-agent-msg-time ${message.role}`}>
                        {message.ts}
                      </span>
                    )}
                  </div>
                ))}
                <div ref={localChatEndRef} />
              </div>
              <div className="v10-agent-input-area">
                <input
                  type="text"
                  placeholder={`Message ${selected.name}...`}
                  className="v10-agent-input"
                  value={localInput}
                  onChange={(e) => onLocalInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSendLocalMessage();
                    }
                  }}
                  disabled={localSending}
                />
                <button className="v10-agent-send-btn" onClick={onSendLocalMessage} disabled={localSending || !localInput.trim()}>
                  Send
                </button>
              </div>
            </>
          ) : (
            <div className="v10-local-agent-setup">
              <p className="v10-local-agent-copy">{selected.detail}</p>
              {selected.id === 'openclaw' && (
                <>
                  <p className="v10-local-agent-copy">
                    Recent OpenClaw releases often use the gateway daemon flow. If chat is still starting or the bridge is offline, run
                    {' '}
                    <code>openclaw doctor</code>
                    {' '}
                    and check
                    {' '}
                    <code>openclaw gateway status</code>
                    . The node will keep using the local bridge until OpenClaw exposes a confirmed gateway route here
                    .
                  </p>
                  <div className="v10-local-agent-actions">
                    <button
                      className="v10-agent-send-btn secondary"
                      onClick={() => onConnectIntegration(selected.id)}
                      disabled={connectBusyId === selected.id}
                    >
                      {connectBusyId === selected.id ? 'Connecting...' : 'Connect OpenClaw'}
                    </button>
                    <a className="v10-agent-link-btn" href={OPENCLAW_DOCS_URL} target="_blank" rel="noreferrer">
                      Docs
                    </a>
                    <a className="v10-agent-link-btn" href={OPENCLAW_RELEASE_URL} target="_blank" rel="noreferrer">
                      Release Notes
                    </a>
                  </div>
                </>
              )}
              {selected.id === 'hermes' && (
                <p className="v10-local-agent-copy">
                  The right panel now uses a reusable local-agent contract so Hermes can plug into the same connect and chat area next.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="v10-agents-section-label">Network Peers</div>
      {loading && <p className="v10-agents-loading">Loading peers...</p>}
      {peerAgents.length === 0 && !loading && (
        <div className="v10-agent-empty-state">No connected peers yet.</div>
      )}
      {peerAgents.map((agent) => (
        <div key={agent.peerId} className="v10-agent-card connected">
          <div className="v10-agent-card-header">
            <span className="v10-agent-card-dot connected" />
            <span className="v10-agent-card-name">{agent.name}</span>
            <span className="v10-agent-card-badge">{agent.connectionTransport ?? 'direct'}</span>
          </div>
          <div className="v10-agent-card-meta">
            <span>{agent.nodeRole ?? 'core'}</span>
            <span title={agent.peerId}>{shortPeerId(agent.peerId)}</span>
            {agent.latencyMs != null && <span>{agent.latencyMs}ms</span>}
            {agent.lastSeen != null && <span>{formatDuration(Date.now() - agent.lastSeen)} ago</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PanelRight() {
  const { stage, advance } = useJourneyStore();
  const [mode, setMode] = useState<'agents' | 'assistant' | 'sessions'>('agents');

  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantSending, setAssistantSending] = useState(false);
  const [assistantSessionId, setAssistantSessionId] = useState<string | undefined>();
  const [sessions, setSessions] = useState<MemorySession[]>([]);

  const [peerAgents, setPeerAgents] = useState<AgentInfo[]>([]);
  const [connections, setConnections] = useState<{ total: number; direct: number; relayed: number }>({ total: 0, direct: 0, relayed: 0 });
  const [peerLoading, setPeerLoading] = useState(true);

  const [integrations, setIntegrations] = useState<LocalAgentIntegration[]>([]);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState('openclaw');
  const [connectBusyId, setConnectBusyId] = useState<string | null>(null);
  const [connectNotice, setConnectNotice] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [localMessagesByIntegration, setLocalMessagesByIntegration] = useState<Record<string, LocalAgentMessage[]>>({});
  const [localInput, setLocalInput] = useState('');
  const [localSending, setLocalSending] = useState(false);
  const [localHistoryLoadedByIntegration, setLocalHistoryLoadedByIntegration] = useState<Record<string, boolean>>({});

  const assistantMessageIdRef = useRef(0);
  const assistantChatEndRef = useRef<HTMLDivElement>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const localAbortRef = useRef<AbortController | null>(null);
  const autoFocusedLocalAgentRef = useRef(false);
  const localChatEndRef = useRef<HTMLDivElement>(null);

  const selectedIntegration = integrations.find((item) => item.id === selectedIntegrationId) ?? integrations[0] ?? null;
  const selectedLocalMessages = selectedIntegration
    ? (localMessagesByIntegration[selectedIntegration.id] ?? [])
    : [];
  const selectedLocalHistoryLoaded = selectedIntegration
    ? (localHistoryLoadedByIntegration[selectedIntegration.id] ?? false)
    : false;

  const scrollAssistantToBottom = useCallback(() => {
    assistantChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollAssistantToBottom, [assistantMessages, scrollAssistantToBottom]);

  const scrollLocalChatToBottom = useCallback(() => {
    localChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollLocalChatToBottom, [selectedIntegration?.id, selectedLocalMessages, scrollLocalChatToBottom]);

  const updateLocalMessages = useCallback((
    integrationId: string,
    updater: (messages: LocalAgentMessage[]) => LocalAgentMessage[],
  ) => {
    setLocalMessagesByIntegration((prev) => ({
      ...prev,
      [integrationId]: updater(prev[integrationId] ?? []),
    }));
  }, []);

  const loadSessions = useCallback(() => {
    api.fetchMemorySessions(20)
      .then(({ sessions: items }: any) => setSessions(items))
      .catch(() => {});
  }, []);

  const refreshPeers = useCallback(async () => {
    try {
      const [agentData, connData] = await Promise.all([
        fetchAgents().catch(() => ({ agents: [] })),
        fetchConnections().catch(() => ({ total: 0, direct: 0, relayed: 0 })),
      ]);
      const agents = (agentData.agents ?? []).filter((agent: AgentInfo) => agent.connectionStatus !== 'self');
      setPeerAgents(agents);
      setConnections({
        total: connData.total ?? 0,
        direct: connData.direct ?? 0,
        relayed: connData.relayed ?? 0,
      });
    } catch {
      // ignore
    }
    setPeerLoading(false);
  }, []);

  const refreshLocalIntegrations = useCallback(async () => {
    try {
      const { integrations: items } = await fetchLocalAgentIntegrations();
      setIntegrations(items);
      if (!items.some((item) => item.id === selectedIntegrationId) && items[0]) {
        setSelectedIntegrationId(items[0].id);
      }
      const chatReady = items.find((item) => item.chatReady);
      if (chatReady && !autoFocusedLocalAgentRef.current) {
        autoFocusedLocalAgentRef.current = true;
        setSelectedIntegrationId(chatReady.id);
        setMode('agents');
      }
    } catch {
      setIntegrations([]);
    }
  }, [selectedIntegrationId]);

  const loadLocalHistory = useCallback(async (integrationId: string) => {
    setLocalHistoryLoadedByIntegration((prev) => ({
      ...prev,
      [integrationId]: false,
    }));
    try {
      const history = await fetchLocalAgentHistory(integrationId, 100);
      const loaded = history.map(mapHistoryMessage);
      updateLocalMessages(integrationId, (prev) => mergeLocalAgentMessages(prev, loaded));
    } catch {
      updateLocalMessages(integrationId, (prev) => prev);
    } finally {
      setLocalHistoryLoadedByIntegration((prev) => ({
        ...prev,
        [integrationId]: true,
      }));
    }
  }, [updateLocalMessages]);

  useEffect(() => {
    loadSessions();
    refreshPeers();
    refreshLocalIntegrations();
  }, [loadSessions, refreshPeers, refreshLocalIntegrations]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshPeers();
      refreshLocalIntegrations();
    }, 15_000);
    return () => clearInterval(intervalId);
  }, [refreshPeers, refreshLocalIntegrations]);

  useEffect(() => {
    if (!selectedIntegration?.chatSupported || !selectedIntegration.chatReady) {
      if (selectedIntegration) {
        setLocalHistoryLoadedByIntegration((prev) => ({
          ...prev,
          [selectedIntegration.id]: selectedIntegration.status === 'coming_soon',
        }));
      }
      return;
    }
    let cancelled = false;
    (async () => {
      await loadLocalHistory(selectedIntegration.id);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedIntegration?.id, selectedIntegration?.chatReady, selectedIntegration?.chatSupported, selectedIntegration?.status, loadLocalHistory]);

  const sendAssistantMessage = useCallback(async () => {
    const text = assistantInput.trim();
    if (!text || assistantSending) return;

    const userMessage: AssistantMessage = { id: ++assistantMessageIdRef.current, role: 'user', content: text };
    const assistantMessage: AssistantMessage = { id: ++assistantMessageIdRef.current, role: 'assistant', content: '', streaming: true };
    setAssistantMessages((prev) => [...prev, userMessage, assistantMessage]);
    setAssistantInput('');
    setAssistantSending(true);

    const assistantId = assistantMessage.id;
    const controller = new AbortController();
    assistantAbortRef.current = controller;

    try {
      const result = await streamChatMessage(text, {
        sessionId: assistantSessionId,
        signal: controller.signal,
        onEvent: (event: ChatAssistantStreamEvent) => {
          if (event.type === 'text_delta') {
            setAssistantMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, content: message.content + event.delta } : message,
              ),
            );
          } else if (event.type === 'meta' && event.sessionId) {
            setAssistantSessionId(event.sessionId);
          }
        },
      });

      setAssistantMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? { ...message, content: result.reply || message.content, streaming: false }
            : message,
        ),
      );

      if (result.sessionId) setAssistantSessionId(result.sessionId);
      if (stage === 0) advance();
      loadSessions();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setAssistantMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content || `Error: ${err.message}`, streaming: false }
              : message,
          ),
        );
      }
    } finally {
      setAssistantSending(false);
      assistantAbortRef.current = null;
    }
  }, [advance, assistantInput, assistantSending, assistantSessionId, loadSessions, stage]);

  const sendLocalMessage = useCallback(async () => {
    const integration = selectedIntegration;
    const text = localInput.trim();
    if (!integration?.chatSupported || !integration.chatReady || !text || localSending) return;
    const integrationId = integration.id;
    const correlationId = crypto.randomUUID();

    const userId = `local:${integrationId}:${correlationId}:user`;
    const assistantId = `local:${integrationId}:${correlationId}:assistant`;
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    updateLocalMessages(integrationId, (prev) => [
      ...prev,
      { id: userId, turnId: correlationId, role: 'user', content: text, ts: now },
      { id: assistantId, turnId: correlationId, role: 'assistant', content: '', ts: now, streaming: true },
    ]);
    setLocalInput('');
    setLocalSending(true);
    setConnectError(null);

    const controller = new AbortController();
    localAbortRef.current = controller;

    try {
      const result = await streamLocalAgentChat(integrationId, text, {
        correlationId,
        signal: controller.signal,
        onEvent: (event: LocalAgentStreamEvent) => {
          if (event.type === 'text_delta') {
            updateLocalMessages(integrationId, (prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, content: message.content + event.delta } : message,
              ),
            );
          }
        },
      });

      updateLocalMessages(integrationId, (prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: result.text || message.content,
                streaming: false,
                ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }
            : message,
        ),
      );
      if (stage === 0) advance();
    } catch (err: any) {
      updateLocalMessages(integrationId, (prev) =>
        prev.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: err?.name === 'AbortError' ? 'Request cancelled.' : `Error: ${err.message}`,
                streaming: false,
              }
            : message,
        ),
      );
    } finally {
      setLocalSending(false);
      localAbortRef.current = null;
    }
  }, [advance, localInput, localSending, selectedIntegration, stage, updateLocalMessages]);

  const connectIntegration = useCallback(async (integrationId: string) => {
    setConnectBusyId(integrationId);
    setConnectError(null);
    setConnectNotice(null);
    try {
      const integration = await connectLocalAgentIntegration(integrationId);
      await refreshLocalIntegrations();
      if (integration.chatReady) {
        setConnectNotice(`${integration.name} is connected and chat-ready.`);
        setMode('agents');
      } else {
        setConnectNotice(`${integration.name} was registered. If the bridge is still offline, restart the local OpenClaw gateway and refresh.`);
      }
    } catch (err: any) {
      setConnectError(err.message);
    } finally {
      setConnectBusyId(null);
    }
  }, [refreshLocalIntegrations]);

  const openSession = useCallback((session: MemorySession) => {
    const mapped: AssistantMessage[] = session.messages.map((message) => ({
      id: ++assistantMessageIdRef.current,
      role: message.author === 'user' ? 'user' : 'assistant',
      content: message.text,
    }));
    setAssistantMessages(mapped);
    setAssistantSessionId(session.session);
    setMode('assistant');
  }, []);

  return (
    <div className="v10-panel-right">
      <div className="v10-agent-mode-tabs">
        <button
          className={`v10-agent-mode-tab ${mode === 'agents' ? 'active' : ''}`}
          onClick={() => setMode('agents')}
        >
          Agents
        </button>
        <button
          className={`v10-agent-mode-tab ${mode === 'assistant' ? 'active' : ''}`}
          onClick={() => setMode('assistant')}
        >
          Assistant
        </button>
        <button
          className={`v10-agent-mode-tab ${mode === 'sessions' ? 'active' : ''}`}
          onClick={() => setMode('sessions')}
        >
          Sessions
        </button>
      </div>

      {mode === 'agents' && (
        <ConnectedAgentsTab
          integrations={integrations}
          selectedIntegrationId={selectedIntegrationId}
          onSelectIntegration={setSelectedIntegrationId}
          onConnectIntegration={connectIntegration}
          onRefreshIntegrations={refreshLocalIntegrations}
          connectBusyId={connectBusyId}
          connectNotice={connectNotice}
          connectError={connectError}
          localMessages={selectedLocalMessages}
          localHistoryLoaded={selectedLocalHistoryLoaded}
          localChatEndRef={localChatEndRef}
          localInput={localInput}
          onLocalInputChange={setLocalInput}
          onSendLocalMessage={sendLocalMessage}
          localSending={localSending}
          peerAgents={peerAgents}
          connections={connections}
          loading={peerLoading}
        />
      )}

      {mode === 'assistant' && (
        <>
          <div className="v10-agent-content">
            {assistantMessages.length === 0 && (
              <div className="v10-agent-empty-state" style={{ marginTop: 40 }}>
                Ask the built-in DKG assistant about your node, memory, or operations.
              </div>
            )}
            <div className="v10-chat-messages">
              {assistantMessages.map((message) => (
                <div key={message.id} className={`v10-chat-msg ${message.role}`}>
                  <div className={`v10-chat-bubble ${message.role}`}>
                    {message.content}
                    {message.streaming && <span className="v10-chat-cursor" />}
                  </div>
                </div>
              ))}
              <div ref={assistantChatEndRef} />
            </div>
          </div>

          <div className="v10-agent-input-area">
            <input
              type="text"
              placeholder="Ask the DKG assistant..."
              className="v10-agent-input"
              value={assistantInput}
              onChange={(e) => setAssistantInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendAssistantMessage();
                }
              }}
              disabled={assistantSending}
            />
            <button className="v10-agent-send-btn" onClick={sendAssistantMessage} disabled={assistantSending || !assistantInput.trim()}>
              Send
            </button>
          </div>
        </>
      )}

      {mode === 'sessions' && (
        <div className="v10-agent-content">
          <div className="v10-sessions-list">
            {sessions.length === 0 ? (
              <p className="v10-agent-empty-state">No assistant sessions yet.</p>
            ) : (
              sessions.map((session) => {
                const preview = session.messages?.[0]?.text?.slice(0, 60) || session.session;
                const count = session.messages?.length ?? 0;
                return (
                  <button
                    key={session.session}
                    className="v10-session-item"
                    onClick={() => openSession(session)}
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
