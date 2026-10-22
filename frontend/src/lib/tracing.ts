/**
 * W3C Trace Context propagation for the frontend (#1233).
 *
 * The browser does not run a full OpenTelemetry SDK, but propagating a
 * `traceparent` header on every API call lets the backend join the browser's
 * trace so a user action can be followed end-to-end (browser → API → services).
 * The server echoes its trace id back via the `x-trace-id` response header.
 */

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i += 1) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generates a fresh W3C `traceparent` header value (sampled). */
export function generateTraceparent(): string {
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  return `00-${traceId}-${spanId}-01`;
}

export function traceIdFromTraceparent(traceparent: string): string | null {
  const parts = traceparent.split('-');
  return parts.length === 4 && parts[1].length === 32 ? parts[1] : null;
}

let lastTraceId: string | null = null;

/** The most recent trace id observed on a response — useful for error reports. */
export function getLastTraceId(): string | null {
  return lastTraceId;
}

export function setLastTraceId(traceId: string | null): void {
  lastTraceId = traceId;
}

/**
 * Returns the headers for an outbound API call, adding a `traceparent` unless
 * the caller already supplied one.
 */
export function traceHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const existing = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'traceparent',
  );
  if (existing) return headers;
  return { ...headers, traceparent: generateTraceparent() };
}

/** Captures the server-issued trace id from a response, if present. */
export function captureTraceId(response: Response): void {
  const traceId =
    response.headers.get('x-trace-id') ||
    response.headers.get('x-correlation-id');
  if (traceId) setLastTraceId(traceId);
}
