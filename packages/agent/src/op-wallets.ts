import { ethers } from 'ethers';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface OpWalletsConfig {
  wallets: Array<{
    address: string;
    privateKey: string;
  }>;
}

const DEFAULT_WALLET_COUNT = 3;

/**
 * Load operational wallets from `wallets.json` in the data directory.
 * If the file doesn't exist, generates `count` fresh wallets and saves them.
 * The file is human-readable JSON — users can add/remove/replace keys
 * (e.g. import into MetaMask, replace with hardware-wallet-backed keys, etc.).
 */
export async function loadOpWallets(
  dataDir: string,
  count: number = DEFAULT_WALLET_COUNT,
): Promise<OpWalletsConfig> {
  const filePath = join(dataDir, 'wallets.json');

  try {
    const raw = await readFile(filePath, 'utf-8');
    const config: OpWalletsConfig = JSON.parse(raw);
    if (config.wallets?.length > 0) {
      for (const w of config.wallets) {
        const derived = new ethers.Wallet(w.privateKey);
        if (derived.address.toLowerCase() !== w.address.toLowerCase()) {
          throw new Error(
            `Address mismatch in wallets.json: expected ${derived.address} but got ${w.address}`,
          );
        }
      }
      return config;
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  const config = generateWallets(count);
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return config;
}

export function generateWallets(count: number): OpWalletsConfig {
  const wallets: OpWalletsConfig['wallets'] = [];
  for (let i = 0; i < count; i++) {
    const w = ethers.Wallet.createRandom();
    wallets.push({ address: w.address, privateKey: w.privateKey });
  }
  return { wallets };
}
