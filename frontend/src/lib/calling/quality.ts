import type { QualityRating, QualitySample } from './types';

/** Extracts a quality sample from RTCPeerConnection.getStats(). */
export async function sampleQuality(
  pc: RTCPeerConnection,
  prev?: { bytes: number; at: number },
): Promise<{ sample: QualitySample; bytes: { bytes: number; at: number } }> {
  const stats = await pc.getStats();
  let rtt: number | null = null;
  let jitter: number | null = null;
  let lost = 0;
  let received = 0;
  let bytes = 0;

  stats.forEach((r: any) => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
      rtt = r.currentRoundTripTime * 1000;
    }
    if (r.type === 'inbound-rtp') {
      if (r.jitter != null) jitter = Math.max(jitter ?? 0, r.jitter * 1000);
      lost += r.packetsLost ?? 0;
      received += r.packetsReceived ?? 0;
      bytes += r.bytesReceived ?? 0;
    }
  });

  const now = Date.now();
  const bitrate =
    prev && now > prev.at ? ((bytes - prev.bytes) * 8) / (now - prev.at) : null;
  const total = lost + received;

  return {
    sample: {
      at: now,
      rttMs: rtt,
      jitterMs: jitter,
      packetLossPct: total > 0 ? (lost / total) * 100 : null,
      bitrateKbps: bitrate !== null ? Math.max(0, Math.round(bitrate)) : null,
    },
    bytes: { bytes, at: now },
  };
}

export function rateQuality(s?: QualitySample | null): QualityRating {
  if (!s || (s.rttMs === null && s.packetLossPct === null)) return 'unknown';
  const rtt = s.rttMs ?? 0;
  const loss = s.packetLossPct ?? 0;
  const jitter = s.jitterMs ?? 0;
  if (rtt < 150 && loss < 1 && jitter < 20) return 'excellent';
  if (rtt < 300 && loss < 3 && jitter < 40) return 'good';
  if (rtt < 500 && loss < 8) return 'fair';
  return 'poor';
}

export function averageRating(samples: QualitySample[]): QualityRating {
  const rated = samples.map(rateQuality).filter((r) => r !== 'unknown');
  if (rated.length === 0) return 'unknown';
  const score = { excellent: 4, good: 3, fair: 2, poor: 1 } as const;
  const avg = rated.reduce((s, r) => s + score[r as keyof typeof score], 0) / rated.length;
  return avg >= 3.5 ? 'excellent' : avg >= 2.5 ? 'good' : avg >= 1.5 ? 'fair' : 'poor';
}
