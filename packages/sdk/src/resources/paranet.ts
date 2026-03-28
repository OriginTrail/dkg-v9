import { HttpClient } from '../http.js';
import type {
  CatchupStatusResponse,
  CreateParanetInput,
  CreateParanetResponse,
  ListParanetsResponse,
  ParanetExistsResponse,
  SubscribeParanetOptions,
  SubscribeParanetResponse,
} from '../types.js';

export class ParanetResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<ListParanetsResponse> {
    return this.http.get<ListParanetsResponse>('/api/paranet/list');
  }

  async create(input: CreateParanetInput): Promise<CreateParanetResponse> {
    return this.http.post<CreateParanetResponse>('/api/paranet/create', input);
  }

  async exists(id: string): Promise<ParanetExistsResponse> {
    return this.http.get<ParanetExistsResponse>(`/api/paranet/exists?id=${encodeURIComponent(id)}`);
  }

  async subscribe(paranetId: string, options?: SubscribeParanetOptions): Promise<SubscribeParanetResponse> {
    return this.http.post<SubscribeParanetResponse>('/api/subscribe', {
      paranetId,
      ...options,
    });
  }

  async catchupStatus(paranetId: string): Promise<CatchupStatusResponse> {
    return this.http.get<CatchupStatusResponse>(`/api/sync/catchup-status?paranetId=${encodeURIComponent(paranetId)}`);
  }
}
