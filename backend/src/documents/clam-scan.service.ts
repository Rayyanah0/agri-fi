import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';

export interface ScanResult {
  isClean: boolean;
  virusName?: string;
}

/**
 * Connects to a ClamAV daemon over TCP and streams the file buffer for scanning.
 * Uses the INSTREAM command protocol (chunk-based streaming).
 */
@Injectable()
export class ClamScanService {
  private readonly logger = new Logger(ClamScanService.name);
  private readonly host: string;
  private readonly port: number;

  /** Default timeout for the lightweight PING availability probe. */
  private static readonly PING_TIMEOUT_MS = 2_000;

  constructor(private readonly config: ConfigService) {
    this.host = config.get<string>('CLAMAV_HOST', 'clamav');
    this.port = config.get<number>('CLAMAV_PORT', 3310);
  }

  get endpoint(): { host: string; port: number } {
    return { host: this.host, port: this.port };
  }

  /**
   * Lightweight availability probe using the ClamAV `zPING` command.
   *
   * Returns `false` (instead of throwing) when the daemon is unreachable or
   * times out, so callers can implement fail-closed behaviour and health
   * endpoints can report degraded mode without an unhandled rejection.
   */
  async isAvailable(
    timeoutMs = ClamScanService.PING_TIMEOUT_MS,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const socket = net.createConnection(this.port, this.host);
      const chunks: Buffer[] = [];

      const finish = (available: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(available);
      };

      socket.setTimeout(timeoutMs);
      socket.setNoDelay(true);

      socket.on('connect', () => {
        // `z` prefix means the command is null-terminated.
        socket.write('zPING\0');
      });

      socket.on('data', (data) => {
        chunks.push(data);
        const response = Buffer.concat(chunks).toString('utf8');
        if (response.includes('PONG')) {
          finish(true);
        } else if (response.includes('UNKNOWN COMMAND')) {
          // Old ClamAV builds without zPING support are still reachable.
          finish(true);
        }
      });

      socket.on('end', () => {
        const response = Buffer.concat(chunks).toString('utf8');
        finish(
          response.includes('PONG') || response.includes('UNKNOWN COMMAND'),
        );
      });

      socket.on('timeout', () => {
        this.logger.warn(
          `ClamAV PING timed out after ${timeoutMs}ms (${this.host}:${this.port})`,
        );
        finish(false);
      });

      socket.on('error', (err) => {
        this.logger.warn(
          `ClamAV PING failed (${this.host}:${this.port}): ${err.message}`,
        );
        finish(false);
      });
    });
  }

  async scan(buffer: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.port, this.host);
      const chunks: Buffer[] = [];

      socket.setTimeout(15000);

      socket.on('connect', () => {
        // Send INSTREAM command
        socket.write('zINSTREAM\0');

        // Send chunk: 4-byte big-endian length + data
        const sizeBuffer = Buffer.alloc(4);
        sizeBuffer.writeUInt32BE(buffer.length, 0);
        socket.write(sizeBuffer);
        socket.write(buffer);

        // Terminate stream with zero-length chunk
        const end = Buffer.alloc(4);
        end.writeUInt32BE(0, 0);
        socket.write(end);
      });

      socket.on('data', (data) => {
        chunks.push(data);
      });

      socket.on('end', () => {
        const response = Buffer.concat(chunks).toString('utf8').trim();
        this.logger.debug(`ClamAV response: ${response}`);

        if (response.includes('OK')) {
          resolve({ isClean: true });
        } else if (response.includes('FOUND')) {
          // Format: "stream: VirusName FOUND"
          const match = response.match(/stream:\s+(.+?)\s+FOUND/);
          resolve({ isClean: false, virusName: match?.[1] ?? 'Unknown' });
        } else {
          reject(new Error(`Unexpected ClamAV response: ${response}`));
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('ClamAV scan timed out'));
      });

      socket.on('error', (err) => {
        this.logger.error(`ClamAV connection error: ${err.message}`);
        reject(err);
      });
    });
  }
}
