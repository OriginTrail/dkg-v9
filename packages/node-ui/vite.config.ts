import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

function readTokenFile(path: string): string {
  try {
    const raw = readFileSync(path, 'utf-8');
    return raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0] || '';
  } catch { return ''; }
}

function readDkgConfig() {
  // Devnet node 1 takes priority (local Hardhat chain with real contracts)
  const devnetNode1 = resolve(__dirname, '../../.devnet/node1');
  if (existsSync(join(devnetNode1, 'api.port'))) {
    const port = parseInt(readFileSync(join(devnetNode1, 'api.port'), 'utf-8').trim(), 10) || 9201;
    const token = readTokenFile(join(devnetNode1, 'auth.token'));
    console.log(`[vite] Using devnet node 1 on port ${port}`);
    return { port, token };
  }

  // Fall back to ~/.dkg (testnet / production node)
  const dkgDir = join(homedir(), '.dkg');
  let port = 9200;
  let token = '';
  try {
    if (existsSync(join(dkgDir, 'api.port'))) {
      port = parseInt(readFileSync(join(dkgDir, 'api.port'), 'utf-8').trim(), 10) || 9200;
    }
  } catch {}
  token = readTokenFile(join(dkgDir, 'auth.token'));
  console.log(`[vite] Using node on port ${port} (from ~/.dkg)`);
  return { port, token };
}

const { port, token } = readDkgConfig();

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-dkg-token',
      apply: 'serve',
      transformIndexHtml(html) {
        if (!token) return html;
        return html.replace('</head>', `<script>window.__DKG_TOKEN__=${JSON.stringify(token)}</script></head>`);
      },
    },
  ],
  root: 'src/ui',
  base: '/ui/',
  build: {
    outDir: '../../dist-ui',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${port}`,
    },
  },
});
