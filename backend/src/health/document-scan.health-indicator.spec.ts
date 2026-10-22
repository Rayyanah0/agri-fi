import { HealthCheckError } from '@nestjs/terminus';
import { DocumentScanHealthIndicator } from './document-scan.health-indicator';

describe('DocumentScanHealthIndicator', () => {
  const endpoint = { host: 'clamav', port: 3310 };

  function createIndicator(
    available: boolean,
    configValues: Record<string, unknown> = { CLAM_SCAN_ENABLED: true },
  ) {
    const clamScanService = {
      endpoint,
      isAvailable: jest.fn().mockResolvedValue(available),
    };
    const config = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key in configValues ? configValues[key] : defaultValue,
      ),
    };
    const indicator = new DocumentScanHealthIndicator(
      clamScanService as any,
      config as any,
    );
    return { indicator, clamScanService };
  }

  it('reports scan_available=true when ClamAV answers PING', async () => {
    const { indicator, clamScanService } = createIndicator(true);

    await expect(indicator.isHealthy('documents')).resolves.toEqual({
      documents: expect.objectContaining({
        status: 'up',
        scan_available: true,
        scan_enabled: true,
        mode: 'scanning',
      }),
    });
    expect(clamScanService.isAvailable).toHaveBeenCalled();
  });

  it('throws HealthCheckError with scan_available=false when ClamAV is down', async () => {
    const { indicator } = createIndicator(false);

    const error = await indicator.isHealthy('documents').catch((err) => err);

    expect(error).toBeInstanceOf(HealthCheckError);
    expect((error as HealthCheckError).causes).toMatchObject({
      documents: expect.objectContaining({
        status: 'down',
        scan_available: false,
        mode: 'fail-closed',
      }),
    });
  });

  it('reports disabled scanning without probing ClamAV', async () => {
    const { indicator, clamScanService } = createIndicator(true, {
      CLAM_SCAN_ENABLED: false,
    });

    await expect(indicator.isHealthy('documents')).resolves.toEqual({
      documents: expect.objectContaining({
        status: 'up',
        scan_available: false,
        scan_enabled: false,
        mode: 'disabled',
      }),
    });
    expect(clamScanService.isAvailable).not.toHaveBeenCalled();
  });
});
