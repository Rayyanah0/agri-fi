export type InvoiceStatus =
  | 'listed'
  | 'verified'
  | 'in_auction'
  | 'funded'
  | 'collected'
  | 'defaulted';

export type DebtorCreditRating = 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B';

export interface FactoringBid {
  id: string;
  investorId: string;
  investorName: string;
  bidAmount: number;
  offeredDiscountPercent: number;
  timestamp: string;
}

export interface FactoredInvoice {
  id: string;
  invoiceNumber: string;
  issuerId: string;
  issuerName: string;
  debtorName: string;
  commodity: string;
  faceValue: number;
  issueDate: string;
  dueDate: string;
  daysToMaturity: number;
  status: InvoiceStatus;
  creditScore: number; // 300 to 850
  creditRating: DebtorCreditRating;
  discountRatePercent: number;
  immediateAdvancePercent: number;
  advanceAmount: number;
  discountFee: number;
  isVerified: boolean;
  verificationDetails: {
    commercialDocVerified: boolean;
    debtorConfirmed: boolean;
    deliveryBillVerified: boolean;
    antiFraudScore: number; // 0-100, 100 = safe
  };
  hasInsurance: boolean;
  insuranceFeePercent: number;
  bids: FactoringBid[];
  fundedBy?: string;
  collectedAt?: string | null;
}

export interface FactoringAnalyticsData {
  totalFactoredVolume: number;
  activeFactoredVolume: number;
  totalCollectedVolume: number;
  averageDiscountYield: number;
  defaultRate: number;
  averageCashoutHours: number;
  insuredInvoicesRatio: number;
  monthlyVolume: Array<{ month: string; volume: number; invoices: number }>;
}

export function deriveCreditRating(score: number): DebtorCreditRating {
  if (score >= 800) return 'AAA';
  if (score >= 740) return 'AA';
  if (score >= 670) return 'A';
  if (score >= 580) return 'BBB';
  if (score >= 500) return 'BB';
  return 'B';
}

export function calculateDiscountFee(
  faceValue: number,
  discountRatePercent: number,
  daysToMaturity: number,
): number {
  const annualRate = discountRatePercent / 100;
  const timeFraction = Math.max(daysToMaturity, 1) / 365;
  return Math.round(faceValue * annualRate * timeFraction * 100) / 100;
}

export function calculateNetAdvance(
  faceValue: number,
  advancePercent: number,
  discountFee: number,
  hasInsurance: boolean,
  insuranceFeePercent = 0.8,
): number {
  const advanceGross = faceValue * (advancePercent / 100);
  const insuranceFee = hasInsurance ? faceValue * (insuranceFeePercent / 100) : 0;
  return Math.round((advanceGross - discountFee - insuranceFee) * 100) / 100;
}

export const INITIAL_INVOICES: FactoredInvoice[] = [
  {
    id: 'inv-cocoa-2026-001',
    invoiceNumber: 'INV-2026-COCOA-01',
    issuerId: 'user-farmer-01',
    issuerName: 'Ghana Cocoa Growers Union',
    debtorName: 'Barry Callebaut AG',
    commodity: 'Grade-A Cocoa Beans',
    faceValue: 85000,
    issueDate: '2026-06-01',
    dueDate: '2026-08-30',
    daysToMaturity: 62,
    status: 'in_auction',
    creditScore: 820,
    creditRating: 'AAA',
    discountRatePercent: 4.5,
    immediateAdvancePercent: 90,
    advanceAmount: 75850,
    discountFee: 650,
    isVerified: true,
    verificationDetails: {
      commercialDocVerified: true,
      debtorConfirmed: true,
      deliveryBillVerified: true,
      antiFraudScore: 98,
    },
    hasInsurance: true,
    insuranceFeePercent: 0.8,
    bids: [
      {
        id: 'bid-1',
        investorId: 'inv-global-1',
        investorName: 'Stellar Trade Fund Ltd',
        bidAmount: 76500,
        offeredDiscountPercent: 4.2,
        timestamp: '2 hours ago',
      },
      {
        id: 'bid-2',
        investorId: 'inv-global-2',
        investorName: 'Atlas Agri Liquidity',
        bidAmount: 76000,
        offeredDiscountPercent: 4.4,
        timestamp: '5 hours ago',
      },
    ],
  },
  {
    id: 'inv-coffee-2026-002',
    invoiceNumber: 'INV-2026-COFFEE-88',
    issuerId: 'user-farmer-02',
    issuerName: 'Nyeri Coffee Cooperative',
    debtorName: 'Starbucks EMEA BV',
    commodity: 'Arabica Green Coffee',
    faceValue: 120000,
    issueDate: '2026-06-10',
    dueDate: '2026-09-15',
    daysToMaturity: 78,
    status: 'verified',
    creditScore: 780,
    creditRating: 'AA',
    discountRatePercent: 5.2,
    immediateAdvancePercent: 88,
    advanceAmount: 104270,
    discountFee: 1332,
    isVerified: true,
    verificationDetails: {
      commercialDocVerified: true,
      debtorConfirmed: true,
      deliveryBillVerified: true,
      antiFraudScore: 95,
    },
    hasInsurance: false,
    insuranceFeePercent: 0.8,
    bids: [],
  },
  {
    id: 'inv-maize-2026-003',
    invoiceNumber: 'INV-2026-MAIZE-14',
    issuerId: 'user-farmer-03',
    issuerName: 'Rift Valley Maize Traders',
    debtorName: 'Unga Holdings Group',
    commodity: 'White Commercial Maize',
    faceValue: 45000,
    issueDate: '2026-05-20',
    dueDate: '2026-07-20',
    daysToMaturity: 22,
    status: 'funded',
    creditScore: 710,
    creditRating: 'A',
    discountRatePercent: 6.0,
    immediateAdvancePercent: 85,
    advanceAmount: 38087,
    discountFee: 162,
    isVerified: true,
    verificationDetails: {
      commercialDocVerified: true,
      debtorConfirmed: true,
      deliveryBillVerified: true,
      antiFraudScore: 92,
    },
    hasInsurance: true,
    insuranceFeePercent: 0.8,
    bids: [
      {
        id: 'bid-3',
        investorId: 'inv-private-3',
        investorName: 'Horizon Capital',
        bidAmount: 38250,
        offeredDiscountPercent: 5.8,
        timestamp: '1 day ago',
      },
    ],
    fundedBy: 'Horizon Capital',
  },
  {
    id: 'inv-tea-2026-004',
    invoiceNumber: 'INV-2026-TEA-55',
    issuerId: 'user-farmer-04',
    issuerName: 'Kericho Highland Tea Estates',
    debtorName: 'Lipton Teas and Infusions',
    commodity: 'Black CTC Tea Pekoe',
    faceValue: 65000,
    issueDate: '2026-04-10',
    dueDate: '2026-06-15',
    daysToMaturity: 0,
    status: 'collected',
    creditScore: 840,
    creditRating: 'AAA',
    discountRatePercent: 4.0,
    immediateAdvancePercent: 92,
    advanceAmount: 59360,
    discountFee: 440,
    isVerified: true,
    verificationDetails: {
      commercialDocVerified: true,
      debtorConfirmed: true,
      deliveryBillVerified: true,
      antiFraudScore: 99,
    },
    hasInsurance: true,
    insuranceFeePercent: 0.8,
    bids: [],
    collectedAt: '2026-06-15',
  },
];

export const MOCK_FACTORING_ANALYTICS: FactoringAnalyticsData = {
  totalFactoredVolume: 5850000,
  activeFactoredVolume: 1240000,
  totalCollectedVolume: 4610000,
  averageDiscountYield: 7.4,
  defaultRate: 0.18,
  averageCashoutHours: 4.8,
  insuredInvoicesRatio: 84,
  monthlyVolume: [
    { month: 'Feb', volume: 650000, invoices: 14 },
    { month: 'Mar', volume: 880000, invoices: 19 },
    { month: 'Apr', volume: 1150000, invoices: 26 },
    { month: 'May', volume: 1420000, invoices: 32 },
    { month: 'Jun', volume: 1750000, invoices: 39 },
  ],
};
