import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { ClamScanService } from '../documents/clam-scan.service';

export interface DocumentScanHealthDetails {
  /** Mirrors the `documents.scan_available` flag exposed on the health endpoint. */
  scan_available: boolean;
  scan_enabled: boolean;
  /** `scanning`, `disabled`, or `fail-closed` when ClamAV cannot be reached. */
  mode: 'scanning' | 'disabled' | 'fail-closed';
  endpoint: { host: string; port: number };
}

/**
 * Reports whether the documents pipeline can actually scan uploads.
 *
 * Document uploads fail closed when ClamAV is unavailable (#967). This
 * indicator surfaces that degraded mode on the admin-only `/health/detail`
 * endpoint **without** taking the whole backend down: liveness/readiness
 * probes use `/health`, which deliberately does not include this check.
 */
@Injectable()
export class DocumentScanHealthIndicator extends HealthIndicator {
  constructor(
    private readonly clamScanService: ClamScanService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async isHealthy(key = 'documents'): Promise<HealthIndicatorResult> {
    const scanEnabled = this.isScanEnabled();
    const endpoint = this.clamScanService.endpoint;

    if (!scanEnabled) {
      const details: DocumentScanHealthDetails = {
        scan_available: false,
        scan_enabled: false,
        mode: 'disabled',
        endpoint,
      };
      return this.getStatus(key, true, details);
    }

    const available = await this.clamScanService.isAvailable();
    const details: DocumentScanHealthDetails = {
      scan_available: available,
      scan_enabled: true,
      mode: available ? 'scanning' : 'fail-closed',
      endpoint,
    };

    if (!available) {
      throw new HealthCheckError(
        `${key} scan unavailable — document uploads are failing closed`,
        this.getStatus(key, false, details),
      );
    }

    return this.getStatus(key, true, details);
  }

  private isScanEnabled(): boolean {
    const raw = this.config?.get?.<string | boolean>('CLAM_SCAN_ENABLED');
    if (raw === undefined || raw === null || raw === '') return true;
    return raw === true || String(raw).toLowerCase() === 'true';
  }
}
