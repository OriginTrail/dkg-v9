import { HttpClient } from '../http.js';
import type {
  AgentChatInput,
  AgentChatResult,
  AgentInvokeSkillInput,
  AgentInvokeSkillResult,
  AgentListFilters,
  AgentListResponse,
  AgentMessagesOptions,
  AgentMessagesResponse,
  AgentSkillFilters,
  AgentSkillsResponse,
} from '../types.js';

export class AgentResource {
  constructor(private readonly http: HttpClient) {}

  async list(filters?: AgentListFilters): Promise<AgentListResponse> {
    const params = new URLSearchParams();
    if (filters?.framework) params.set('framework', filters.framework);
    if (filters?.skillType) params.set('skill_type', filters.skillType);
    const qs = params.toString();
    return this.http.get<AgentListResponse>(`/api/agents${qs ? `?${qs}` : ''}`);
  }

  async skills(filters?: AgentSkillFilters): Promise<AgentSkillsResponse> {
    const params = new URLSearchParams();
    if (filters?.skillType) params.set('skillType', filters.skillType);
    const qs = params.toString();
    return this.http.get<AgentSkillsResponse>(`/api/skills${qs ? `?${qs}` : ''}`);
  }

  async invokeSkill(input: AgentInvokeSkillInput): Promise<AgentInvokeSkillResult> {
    return this.http.post<AgentInvokeSkillResult>('/api/invoke-skill', {
      peerId: input.peerId,
      skillUri: input.skillUri,
      input: input.input ?? '',
    });
  }

  async chat(input: AgentChatInput): Promise<AgentChatResult> {
    return this.http.post<AgentChatResult>('/api/chat', input);
  }

  async messages(options?: AgentMessagesOptions): Promise<AgentMessagesResponse> {
    const params = new URLSearchParams();
    if (options?.peer) params.set('peer', options.peer);
    if (typeof options?.since === 'number') params.set('since', String(options.since));
    if (typeof options?.limit === 'number') params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.http.get<AgentMessagesResponse>(`/api/messages${qs ? `?${qs}` : ''}`);
  }
}
