import { render, screen, waitFor } from '@testing-library/react';
import { SupplyChainFinanceDashboard } from '../SupplyChainFinanceDashboard';
import type { ScfSummary } from '../SupplyChainFinanceDashboard';

const MOCK_SUMMARY: ScfSummary = {
  role: 'buyer',
  fetchedAt: new Date('2024-07-15T10:00:00Z').toISOString(),
  pool: {
    totalCapitalUsd: 5_000_000,
    utilizedCapitalUsd: 3_200_000,
    availableCapitalUsd: 1_800_000,
    utilizationPct: 64,
    weightedAvgDiscountPct: 1.8,
  },
  invoices: [
    {
      id: 'inv-001',
      buyerName: 'AgriCo Ltd',
      supplierName: 'Green Farm Co-op',
      commodity: 'cocoa',
      faceValueUsd: 120_000,
      discountRatePct: 1.5,
      earlyPaymentAmountUsd: 118_200,
      dueDateIso: '2024-09-01T00:00:00Z',
      status: 'financing_offered',
    },
  ],
  suggestions: [
    {
      counterpartyId: 'cp-1',
      counterpartyName: 'Sunrise Traders',
      currentPaymentTermsDays: 30,
      suggestedTermsDays: 60,
      estimatedSavingsUsd: 4_200,
      rationale: 'Extending terms reduces short-term borrowing cost.',
    },
  ],
};

function mockFetch(summary: ScfSummary) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => summary,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SupplyChainFinanceDashboard (#1220)', () => {
  it('renders loading state initially', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    render(<SupplyChainFinanceDashboard pollMs={0} />);
    expect(screen.getByTestId('scf-loading')).toBeInTheDocument();
  });

  it('renders pool card, invoices, and suggestions after fetch', async () => {
    mockFetch(MOCK_SUMMARY);
    render(<SupplyChainFinanceDashboard pollMs={0} />);

    await waitFor(() => expect(screen.getByTestId('scf-dashboard')).toBeInTheDocument());
    expect(screen.getByTestId('scf-pool-card')).toBeInTheDocument();
    expect(screen.getByTestId('scf-invoice-row-inv-001')).toBeInTheDocument();
    expect(screen.getByTestId('scf-suggestion-cp-1')).toBeInTheDocument();
  });

  it('shows the invoice table with correct face value', async () => {
    mockFetch(MOCK_SUMMARY);
    render(<SupplyChainFinanceDashboard pollMs={0} />);

    await waitFor(() => screen.getByTestId('scf-invoice-table'));
    expect(screen.getByText('$120,000')).toBeInTheDocument();
    expect(screen.getByText('AgriCo Ltd')).toBeInTheDocument();
  });

  it('shows working capital suggestion with savings', async () => {
    mockFetch(MOCK_SUMMARY);
    render(<SupplyChainFinanceDashboard pollMs={0} />);

    await waitFor(() => screen.getByTestId('scf-suggestions'));
    expect(screen.getByText('Sunrise Traders', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('$4,200')).toBeInTheDocument();
  });

  it('renders empty state when no invoices are present', async () => {
    mockFetch({ ...MOCK_SUMMARY, invoices: [] });
    render(<SupplyChainFinanceDashboard pollMs={0} />);

    await waitFor(() => screen.getByTestId('scf-empty'));
  });

  it('renders error state on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    render(<SupplyChainFinanceDashboard pollMs={0} />);

    await waitFor(() => screen.getByTestId('scf-error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Server error 503');
  });
});
