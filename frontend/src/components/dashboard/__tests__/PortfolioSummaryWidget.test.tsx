import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortfolioSummaryWidget, {
  buildAllocationRows,
} from '../PortfolioSummaryWidget';
import { apiClient, type PortfolioAllocationSlice, type PortfolioSummary } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiClient: { getPortfolioSummary: vi.fn() },
}));

// jsdom cannot measure the donut's container, so swap recharts for stubs and
// keep the widget's own state handling under test.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="allocation-chart">{children}</div>
  ),
  PieChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  Tooltip: () => null,
}));

function slice(
  overrides: Partial<PortfolioAllocationSlice> = {},
): PortfolioAllocationSlice {
  return {
    deal_id: 'deal-1',
    title: 'Cocoa Harvest 2026',
    token_symbol: 'COCOA',
    commodity: 'Cocoa',
    deal_status: 'funded',
    amount_usd: 1000,
    share_pct: 100,
    expected_return_usd: 1200,
    realized_return_usd: null,
    position_count: 1,
    ...overrides,
  };
}

function summary(
  overrides: Partial<PortfolioSummary> = {},
): PortfolioSummary {
  return {
    investor_id: 'investor-1',
    currency: 'USD',
    total_invested: 12500,
    current_value: 14375,
    expected_returns: 14375,
    returns_paid: 0,
    roi_pct: 15,
    active_deal_count: 3,
    invested_deal_count: 4,
    position_count: 5,
    allocation: [
      slice({ deal_id: 'deal-1', token_symbol: 'COCOA', amount_usd: 7500, share_pct: 60 }),
      slice({ deal_id: 'deal-2', token_symbol: 'COFFEE', amount_usd: 5000, share_pct: 40 }),
    ],
    generated_at: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

const getSummary = vi.mocked(apiClient.getPortfolioSummary);

describe('PortfolioSummaryWidget', () => {
  beforeEach(() => {
    getSummary.mockReset();
  });

  it('shows a skeleton while the summary is loading', () => {
    getSummary.mockReturnValue(new Promise(() => {}));

    render(<PortfolioSummaryWidget />);

    expect(
      screen.getByRole('status', { name: /loading portfolio summary/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Total Invested')).not.toBeInTheDocument();
  });

  it('renders the headline stats once loaded', async () => {
    getSummary.mockResolvedValue(summary());

    render(<PortfolioSummaryWidget />);

    expect(await screen.findByText('Total Invested')).toBeInTheDocument();
    expect(screen.getByText('Current Value')).toBeInTheDocument();
    expect(screen.getByText('ROI')).toBeInTheDocument();
    expect(screen.getByText('+15.0%')).toBeInTheDocument();
    expect(screen.getByText('Active Deals')).toBeInTheDocument();
    expect(screen.getByText('4 deals · 5 positions')).toBeInTheDocument();
  });

  it('labels realised proceeds once the portfolio has paid out', async () => {
    getSummary.mockResolvedValue(summary({ returns_paid: 2400 }));

    render(<PortfolioSummaryWidget />);

    expect(await screen.findByText(/paid out/)).toBeInTheDocument();
  });

  it('lists each allocation slice with its share of capital', async () => {
    getSummary.mockResolvedValue(summary());

    render(<PortfolioSummaryWidget />);

    expect(await screen.findByText('COCOA')).toBeInTheDocument();
    expect(screen.getByText('COFFEE')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    expect(screen.getByText('40.0%')).toBeInTheDocument();
    expect(screen.getByTestId('allocation-chart')).toBeInTheDocument();
  });

  it('prompts an investor with no positions to browse the marketplace', async () => {
    getSummary.mockResolvedValue(
      summary({
        total_invested: 0,
        current_value: 0,
        expected_returns: 0,
        roi_pct: 0,
        active_deal_count: 0,
        invested_deal_count: 0,
        position_count: 0,
        allocation: [],
      }),
    );

    render(<PortfolioSummaryWidget />);

    expect(
      await screen.findByText(/fund a deal and this panel/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse marketplace/i })).toHaveAttribute(
      'href',
      '/marketplace',
    );
  });

  it('recovers from a failed fetch through the retry button', async () => {
    getSummary.mockRejectedValueOnce(new Error('network down'));

    render(<PortfolioSummaryWidget />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your portfolio summary/i);

    getSummary.mockResolvedValue(summary());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Total Invested')).toBeInTheDocument();
    expect(getSummary).toHaveBeenCalledTimes(2);
  });

  it('fetches the summary once per mount', async () => {
    getSummary.mockResolvedValue(summary());

    render(<PortfolioSummaryWidget />);
    await screen.findByText('Total Invested');

    expect(getSummary).toHaveBeenCalledTimes(1);
  });
});

describe('buildAllocationRows', () => {
  const many = (count: number): PortfolioAllocationSlice[] =>
    Array.from({ length: count }, (_, index) =>
      slice({
        deal_id: `deal-${index}`,
        token_symbol: `TOK${index}`,
        amount_usd: 100,
        share_pct: 100 / count,
      }),
    );

  it('keeps the label of a deal when it fits within the top slices', () => {
    const rows = buildAllocationRows(many(3));

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.key)).toEqual(['deal-0', 'deal-1', 'deal-2']);
  });

  it('folds everything past the seventh slice into one Other row', () => {
    const rows = buildAllocationRows(many(10));

    expect(rows).toHaveLength(8);
    expect(rows[7]).toMatchObject({
      key: 'other',
      label: 'Other (3)',
      amount_usd: 300,
    });
  });

  it('falls back through title and commodity when a deal has no token', () => {
    const rows = buildAllocationRows([
      slice({ token_symbol: null, title: 'Maize 2026' }),
      slice({ deal_id: 'deal-2', token_symbol: null, title: '', commodity: 'Rice' }),
      slice({ deal_id: 'deal-3', token_symbol: null, title: '', commodity: null }),
    ]);

    expect(rows.map((row) => row.label)).toEqual([
      'Maize 2026',
      'Rice',
      'Untitled deal',
    ]);
  });

  it('handles an empty allocation', () => {
    expect(buildAllocationRows([])).toEqual([]);
  });
});
