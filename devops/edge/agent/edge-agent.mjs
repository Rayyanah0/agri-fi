import { createHmac, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';

const apiUrl = new URL(process.env.EDGE_CLOUD_API_URL || 'https://api.agri-fi.example.com/v1/edge/');
const nodeId = process.env.EDGE_NODE_ID;
const region = process.env.EDGE_REGION;
const secret = process.env.EDGE_NODE_SECRET;
const spoolPath = resolve(process.env.EDGE_SPOOL_PATH || '/var/lib/agri-edge/events.ndjson');
const listenPort = Number(process.env.EDGE_AGENT_PORT || 8080);
const maxBatch = 100;

if (apiUrl.protocol !== 'https:' || !nodeId || !region || !secret || secret.length < 32) {
  throw new Error('HTTPS cloud URL, node ID, region, and a 32-character EDGE_NODE_SECRET are required');
}

let syncing = false;
let bytesSynced = 0;
let lastError = null;
let lastSyncMs = null;
let spoolOperations = Promise.resolve();

function withSpoolLock(operation) {
  const result = spoolOperations.then(operation, operation);
  spoolOperations = result.then(() => undefined, () => undefined);
  return result;
}

function signedHeaders(method, path, body) {
  const timestamp = String(Date.now());
  const canonical = `${timestamp}\n${method}\n${path}\n${JSON.stringify(body)}`;
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  return { 'content-type': 'application/json', 'x-edge-node': nodeId, 'x-edge-timestamp': timestamp, 'x-edge-signature': signature };
}

async function post(path, body) {
  const url = new URL(path, apiUrl);
  const response = await fetch(url, { method: 'POST', headers: signedHeaders('POST', url.pathname, body), body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Cloud returned HTTP ${response.status}`);
  return response.json();
}

async function readSpool() {
  try {
    const contents = await readFile(spoolPath, 'utf8');
    return contents.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendEvent(event) {
  return withSpoolLock(() => appendFile(spoolPath, `${JSON.stringify(event)}\n`, { mode: 0o600 }));
}

async function acknowledgeBatch(batch) {
  const acknowledgedIds = new Set(batch.map((event) => event.eventId));
  await withSpoolLock(async () => {
    const current = await readSpool();
    const remaining = current.filter((event) => !acknowledgedIds.has(event.eventId));
    const serialized = remaining.map((event) => JSON.stringify(event)).join('\n');
    await writeFile(`${spoolPath}.tmp`, serialized ? `${serialized}\n` : '', { mode: 0o600 });
    await rename(`${spoolPath}.tmp`, spoolPath);
  });
}

async function syncOnce() {
  if (syncing) return;
  syncing = true;
  const startedAt = Date.now();
  try {
    const events = await withSpoolLock(readSpool);
    const batch = events.slice(0, maxBatch);
    await post('heartbeat', { region, latencyMs: lastSyncMs || 0, queuedItems: events.length, bytesSynced, lastError });
    if (batch.length) {
      const result = await post('sync', { events: batch });
      if (result.accepted + result.duplicates !== batch.length) throw new Error('Cloud acknowledged an incomplete sync batch');
      await acknowledgeBatch(batch);
      bytesSynced += Buffer.byteLength(JSON.stringify(batch));
    }
    lastError = null;
    lastSyncMs = Date.now() - startedAt;
    await post('heartbeat', { region, latencyMs: lastSyncMs, queuedItems: Math.max(0, events.length - batch.length), bytesSynced, lastError });
  } catch (error) {
    lastError = String(error.message || error).slice(0, 1000);
  } finally {
    syncing = false;
  }
}

await mkdir(dirname(spoolPath), { recursive: true, mode: 0o700 });
const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', nodeId, queuedItems: (await readSpool()).length, lastError }));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/events') {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  try {
    const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const entry = { eventId: String(event.eventId || randomUUID()), type: String(event.type || ''), payload: event.payload };
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(entry.eventId) || !/^[a-zA-Z0-9._-]{1,100}$/.test(entry.type) || !entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload)) throw new Error('Expected eventId, type, and object payload');
    await appendEvent(entry);
    response.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: true, eventId: entry.eventId }));
    void syncOnce();
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error.message }));
  }
});

server.listen(listenPort, '0.0.0.0');
setInterval(() => void syncOnce(), 15_000).unref();
void syncOnce();