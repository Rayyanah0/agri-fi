import { of, throwError } from 'rxjs';

import { PrometheusQueryService } from './prometheus-query.service';

describe('PrometheusQueryService', () => {
  let service: PrometheusQueryService;
  let httpMock: { get: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(() => {
    httpMock = { get: jest.fn() };
    configMock = {
      get: jest.fn((key: string, fallback?: string) => fallback),
    };

    service = new PrometheusQueryService(
      httpMock as never,
      configMock as never,
    );
  });

  it('returns the numeric value of every series', async () => {
    httpMock.get.mockReturnValue(
      of({
        data: {
          status: 'success',
          data: {
            resultType: 'vector',
            result: [
              {
                metric: { pod: 'backend-1' },
                value: [1700000000, '42.5'],
              },
            ],
          },
        },
      }),
    );

    const samples = await service.query('up');

    expect(samples).toHaveLength(1);
    expect(samples[0].value).toBeCloseTo(42.5);
    expect(samples[0].metric.pod).toBe('backend-1');
  });

  it('returns an empty result when Prometheus reports an error', async () => {
    httpMock.get.mockReturnValue(
      of({ data: { status: 'error', error: 'bad query' } }),
    );

    const samples = await service.query('up');

    expect(samples).toEqual([]);
  });

  it('returns an empty result when the request fails', async () => {
    httpMock.get.mockReturnValue(throwError(() => new Error('unreachable')));

    const samples = await service.query('up');

    expect(samples).toEqual([]);
  });

  it('returns the highest value of a query', async () => {
    httpMock.get.mockReturnValue(
      of({
        data: {
          status: 'success',
          data: {
            result: [
              { metric: {}, value: [0, '10'] },
              { metric: {}, value: [0, '25'] },
            ],
          },
        },
      }),
    );

    expect(await service.queryMax('up')).toBeCloseTo(25);
  });

  it('returns null when a query has no result', async () => {
    httpMock.get.mockReturnValue(
      of({ data: { status: 'success', data: { result: [] } } }),
    );

    expect(await service.queryMax('up')).toBeNull();
  });

  it('returns the firing and pending alerts', async () => {
    httpMock.get.mockReturnValue(
      of({
        data: {
          status: 'success',
          data: {
            alerts: [
              {
                labels: { alertname: 'SelfHealingPodCrashLoop' },
                annotations: { summary: 'Crash loop' },
                state: 'firing',
                activeAt: '2026-01-01T00:00:00Z',
                value: '4',
              },
              {
                labels: { alertname: 'Resolved' },
                annotations: {},
                state: 'inactive',
                activeAt: '2026-01-01T00:00:00Z',
                value: '0',
              },
            ],
          },
        },
      }),
    );

    const alerts = await service.getAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].labels.alertname).toBe('SelfHealingPodCrashLoop');
  });

  it('returns an empty list when the alerts query fails', async () => {
    httpMock.get.mockReturnValue(throwError(() => new Error('unreachable')));

    expect(await service.getAlerts()).toEqual([]);
  });
});
