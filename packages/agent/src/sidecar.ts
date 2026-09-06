/**
 * Desktop chat sidecar — old /chat/stream plus the @ritual/agent loop.
 * Vite SPA talks here (127.0.0.1:8787). Tauri launches the compiled
 * ritual-agent binary, or `node dist/sidecar.bundle.js` during `tauri dev`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleChatStreamRequest } from '@ritual/chat-runtime/handle-chat-stream';
import { handleAgentRequest, isAgentPath } from './http.js';

const DEFAULT_PORT = Number(process.env.RITUAL_CHAT_RUNTIME_PORT || 8787);
const HOST = process.env.RITUAL_CHAT_RUNTIME_HOST || '127.0.0.1';

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tokenFromRequest(req: IncomingMessage): string {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
}

async function pipeWebResponse(webResponse: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  setCors(res);
  if (!webResponse.body) {
    const text = await webResponse.text();
    res.end(text);
    return;
  }
  const reader = webResponse.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

export function startAgentSidecar(port = DEFAULT_PORT, host = HOST) {
  const server = createServer(async (req, res) => {
    setCors(res);
    const url = new URL(req.url || '/', `http://${host}:${port}`);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/chat/health')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, service: 'ritual-chat-runtime', agent: true }));
      return;
    }

    const abort = new AbortController();
    req.on('close', () => abort.abort());

    if (req.method && isAgentPath(url.pathname)) {
      try {
        const raw = req.method === 'GET' ? '' : await readBody(req);
        const webResponse = await handleAgentRequest({
          method: req.method,
          pathname: url.pathname,
          url,
          token: tokenFromRequest(req),
          body: raw,
          signal: abort.signal,
        });
        if (webResponse) {
          await pipeWebResponse(webResponse, res);
          return;
        }
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'Agent sidecar failed',
          details: error instanceof Error ? error.message : 'Unknown error',
        }));
        return;
      }
    }

    const isStream = url.pathname === '/chat/stream' || url.pathname === '/api/chat/stream';
    if (req.method === 'POST' && isStream) {
      try {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const webResponse = await handleChatStreamRequest({
          token: tokenFromRequest(req),
          body,
          signal: abort.signal,
        });
        await pipeWebResponse(webResponse, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'Sidecar failed',
          details: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise<{ server: ReturnType<typeof createServer>; port: number; host: string }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      console.log(`ritual-agent sidecar listening on http://${host}:${port}`);
      resolve({ server, port, host });
    });
  });
}
