import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleAppRequest, type LoadedApp } from '../src/app-loader.js';

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

function makeApp(id: string, staticDir: string): LoadedApp {
  return {
    id,
    label: `Test ${id}`,
    path: `/apps/${id}`,
    staticDir,
    handler: async () => false,
  };
}

function httpGet(server: Server, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    import('node:http').then(({ get }) => {
      get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      }).on('error', reject);
    });
  });
}

function fakeReqRes(): { req: IncomingMessage; res: ServerResponse & { _status: number; _body: string; _headers: Record<string, unknown> } } {
  const req = { method: 'GET', headers: {} } as unknown as IncomingMessage;
  const collected = { _status: 0, _body: '', _headers: {} as Record<string, unknown> };
  const res = {
    ...collected,
    writeHead(code: number, headers?: Record<string, unknown>) {
      collected._status = code;
      Object.assign(collected._headers, headers);
    },
    end(data?: string | Buffer) {
      collected._body = typeof data === 'string' ? data : data?.toString() ?? '';
    },
    setHeader() {},
  } as unknown as ServerResponse & typeof collected;
  Object.defineProperty(res, '_status', { get: () => collected._status });
  Object.defineProperty(res, '_body', { get: () => collected._body });
  Object.defineProperty(res, '_headers', { get: () => collected._headers });
  return { req, res };
}

describe('app-loader', () => {
  let staticDir: string;
  let server: Server;
  let apps: LoadedApp[];

  beforeEach(async () => {
    staticDir = join(tmpdir(), `app-loader-test-${Date.now()}`);
    await mkdir(staticDir, { recursive: true });
    await write(join(staticDir, 'index.html'), '<html><head></head><body>App UI</body></html>');
    await write(join(staticDir, 'assets', 'style.css'), 'body { color: red }');

    apps = [makeApp('test-app', staticDir)];

    server = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const handled = await handleAppRequest(req, res, url, apps);
      if (!handled) {
        res.writeHead(404);
        res.end('not handled');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(staticDir, { recursive: true, force: true });
  });

  it('serves index.html for app root', async () => {
    const res = await httpGet(server, '/apps/test-app/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('App UI');
  });

  it('serves legitimate nested assets', async () => {
    const res = await httpGet(server, '/apps/test-app/assets/style.css');
    expect(res.status).toBe(200);
    expect(res.body).toContain('color: red');
  });

  it('returns /api/apps listing', async () => {
    const res = await httpGet(server, '/api/apps');
    expect(res.status).toBe(200);
    const list = JSON.parse(res.body);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('test-app');
  });

  it('returns 404 for unknown app', async () => {
    const res = await httpGet(server, '/apps/nonexistent/');
    expect(res.status).toBe(404);
  });

  describe('path traversal prevention (defense-in-depth)', () => {
    it('URL normalization prevents ../  traversal at the HTTP layer', async () => {
      const res = await httpGet(server, '/apps/test-app/../../package.json');
      expect(res.status).toBe(404);
    });

    it('serveAppStatic rejects ../ if URL bypasses normalization', async () => {
      const { req, res } = fakeReqRes();
      const url = { pathname: '/apps/test-app/../../package.json' } as URL;

      await handleAppRequest(req, res, url, apps);
      expect(res._status).toBe(400);
      expect(res._body).toContain('Invalid path');
    });

    it('serveAppStatic rejects deeply nested traversal', async () => {
      const { req, res } = fakeReqRes();
      const url = { pathname: '/apps/test-app/assets/../../../etc/passwd' } as URL;

      await handleAppRequest(req, res, url, apps);
      expect(res._status).toBe(400);
      expect(res._body).toContain('Invalid path');
    });

    it('serveAppStatic serves index.html for unknown extensions (SPA fallback)', async () => {
      const { req, res } = fakeReqRes();
      const url = { pathname: '/apps/test-app/some/route' } as URL;

      await handleAppRequest(req, res, url, apps, 'test-token');
      expect(res._status).toBe(200);
      expect(res._body).toContain('App UI');
    });
  });
});
