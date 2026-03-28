import { HttpClient } from '../http.js';
import type { ContextCreateInput, ContextCreateResult } from '../types.js';

export class ContextResource {
  constructor(private readonly http: HttpClient) {}

  async create(input: ContextCreateInput): Promise<ContextCreateResult> {
    return this.http.post<ContextCreateResult>('/api/context-graph/create', {
      participantIdentityIds: input.participantIdentityIds.map((id) => String(id)),
      requiredSignatures: input.requiredSignatures,
    });
  }
}
