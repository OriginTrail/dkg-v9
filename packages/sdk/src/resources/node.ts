import type { NodeStatus } from '../types.js';
import { HttpClient } from '../http.js';

export class NodeResource {
  constructor(private readonly http: HttpClient) {}

  async status(): Promise<NodeStatus> {
    return this.http.get<NodeStatus>('/api/status');
  }
}
