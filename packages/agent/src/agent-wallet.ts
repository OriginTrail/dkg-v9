export interface AgentWallet {
  masterKey: Uint8Array;
  peerId(): string;
  deriveEvmWallet(): { address: string; sign(tx: Uint8Array): Promise<Uint8Array> };
  deriveSolanaWallet(): { address: string; sign(tx: Uint8Array): Promise<Uint8Array> };
}
