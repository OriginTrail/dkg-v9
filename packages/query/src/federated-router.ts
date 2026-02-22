import type { ProtocolRouter } from '@dkg/core';
import {
  PROTOCOL_QUERY,
  encodeQueryRequest,
  decodeQueryResponse,
} from '@dkg/core';
import type { QueryResult, QueryOptions } from './query-engine.js';
import type { DKGQueryEngine } from './dkg-query-engine.js';

/**
 * Routes SPARQL queries to remote peers if the local store doesn't have the data,
 * or if federated query mode is requested.
 */
export class FederatedRouter {
  private readonly localEngine: DKGQueryEngine;
  private readonly router: ProtocolRouter;

  constructor(localEngine: DKGQueryEngine, router: ProtocolRouter) {
    this.localEngine = localEngine;
    this.router = router;
  }

  async query(
    sparql: string,
    options: QueryOptions & { peers?: string[] } = {},
  ): Promise<QueryResult> {
    // Local-first: try local store
    const localResult = await this.localEngine.query(sparql, options);

    // If not federated or no peers, return local result
    if (!options.federated || !options.peers?.length) {
      return localResult;
    }

    // Federated: fan out to peers
    const allBindings = [...localResult.bindings];

    const peerQueries = options.peers.map(async (peerId) => {
      try {
        const encoded = encodeQueryRequest({
          sparql,
          paranetId: options.paranetId ?? '',
          timeout: options.timeout ?? 10000,
        });

        const responseData = await this.router.send(
          peerId,
          PROTOCOL_QUERY,
          encoded,
        );

        const response = decodeQueryResponse(responseData);
        if (response.error) return [];

        if (response.bindings?.length) {
          const decoded = JSON.parse(
            new TextDecoder().decode(response.bindings),
          ) as Array<Record<string, string>>;
          return decoded;
        }
        return [];
      } catch {
        return [];
      }
    });

    const peerResults = await Promise.allSettled(peerQueries);
    for (const result of peerResults) {
      if (result.status === 'fulfilled') {
        allBindings.push(...result.value);
      }
    }

    return { bindings: allBindings };
  }
}
