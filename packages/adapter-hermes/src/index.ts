/**
 * @origintrail-official/dkg-adapter-hermes
 *
 * Connects Hermes AI agents to a DKG V10 node for verifiable shared memory.
 * The Hermes Python plugin (plugins/memory/dkg/) talks to this adapter
 * via HTTP. All knowledge goes through DKG Working Memory assertions.
 */

export { HermesAdapterPlugin } from './HermesAdapterPlugin.js';
export type {
  HermesAdapterConfig,
  DaemonPluginApi,
  SessionTurnPayload,
  SessionEndPayload,
} from './types.js';
