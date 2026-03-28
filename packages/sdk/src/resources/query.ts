import { HttpClient } from '../http.js';
import type {
  QueryOptions,
  QueryRemoteInput,
  QueryRemoteResult,
  QueryResult,
} from '../types.js';

export class QueryResource {
  constructor(private readonly http: HttpClient) {}

  async sparql(sparql: string, options?: QueryOptions): Promise<QueryResult> {
    return this.http.post<QueryResult>('/api/query', {
      sparql,
      paranetId: options?.paranetId,
    });
  }

  async remote(input: QueryRemoteInput): Promise<QueryRemoteResult> {
    return this.http.post<QueryRemoteResult>('/api/query-remote', input);
  }
}
