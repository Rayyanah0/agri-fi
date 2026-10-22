import { describe, expect, it } from 'vitest';
import {
  captureTraceId,
  generateTraceparent,
  getLastTraceId,
  setLastTraceId,
  traceHeaders,
  traceIdFromTraceparent,
} from '@/lib/tracing';

describe('tracing helpers (#1233)', () => {
  it('generates a valid sampled W3C traceparent', () => {
    const traceparent = generateTraceparent();
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(traceIdFromTraceparent(traceparent)).toHaveLength(32);
  });

  it('adds a traceparent header when none is present', () => {
    const headers = traceHeaders({ 'Content-Type': 'application/json' });
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('preserves a caller-supplied traceparent', () => {
    const existing = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';
    const headers = traceHeaders({ traceparent: existing });
    expect(headers.traceparent).toBe(existing);
  });

  it('captures the server trace id from response headers', () => {
    setLastTraceId(null);
    const response = {
      headers: {
        get: (name: string) =>
          name === 'x-trace-id' ? 'c'.repeat(32) : null,
      },
    } as unknown as Response;

    captureTraceId(response);
    expect(getLastTraceId()).toBe('c'.repeat(32));
  });
});
