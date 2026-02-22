export {
  type Quad,
  type TripleStore,
  type QueryResult,
  type SelectResult,
  type ConstructResult,
  type AskResult,
  type TripleStoreConfig,
  type TripleStoreBackend,
  registerTripleStoreAdapter,
  createTripleStore,
} from './triple-store.js';

export { OxigraphStore } from './adapters/oxigraph.js';
export { GraphManager } from './graph-manager.js';
export { PrivateContentStore } from './private-store.js';

// Side-effect: register built-in adapters
import './adapters/oxigraph.js';
