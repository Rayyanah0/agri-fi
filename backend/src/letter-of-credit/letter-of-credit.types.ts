export type LetterOfCreditStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'ADVISED'
  | 'CONFIRMED'
  | 'DOCUMENTS_PRESENTED'
  | 'VERIFIED'
  | 'DISCREPANT'
  | 'SETTLED'
  | 'CANCELLED'
  | 'EXPIRED';

export type LcType =
  | 'IRREVOCABLE_TRANSFERABLE'
  | 'IRREVOCABLE_CONFIRMED'
  | 'STANDBY'
  | 'REVOLVING';

export type Ucp600DocumentType =
  | 'BILL_OF_LADING'
  | 'COMMERCIAL_INVOICE'
  | 'CERTIFICATE_OF_ORIGIN'
  | 'PHYTOSANITARY_CERTIFICATE'
  | 'INSURANCE_CERTIFICATE'
  | 'PACKING_LIST'
  | 'INSPECTION_CERTIFICATE';

export interface PresentedDocument {
  id: string;
  docType: Ucp600DocumentType;
  documentNumber: string;
  issueDate: string;
  documentHash: string;
  documentUrl: string;
  isCompliant: boolean;
  discrepancies: string[];
  verifiedAt: string | null;
}

export interface LcAmendment {
  id: string;
  amendmentNumber: number;
  requestedBy: string;
  requestedAt: string;
  proposedChanges: Record<string, any>;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  swiftMt707Message: string;
  decisionReason?: string;
  decidedAt?: string;
}

export interface LetterOfCredit {
  id: string;
  lcNumber: string;
  dealId: string;
  dealTitle?: string;
  commodity: string;
  lcType: LcType;
  issuingBank: string;
  advisingBank: string;
  applicantId: string;
  applicantName?: string;
  beneficiaryId: string;
  beneficiaryName?: string;
  amount: number;
  currency: string;
  tolerancePercentage: number; // Article 30 (default 5%)
  expiryDate: string;
  presentationPeriodDays: number; // Article 14c (default 21 days)
  shipmentDate: string;
  portOfLoading: string;
  portOfDischarge: string;
  status: LetterOfCreditStatus;
  ucp600Compliant: boolean;
  swiftMt700Message: string;
  blockchainAnchoringHash: string;
  blockchainTxHash: string | null;
  requiredDocuments: Ucp600DocumentType[];
  presentedDocuments: PresentedDocument[];
  amendments: LcAmendment[];
  createdAt: string;
  updatedAt: string;
  settledAt?: string | null;
}

export interface LcAnalytics {
  totalIssuedVolume: number;
  totalSettledVolume: number;
  activeCount: number;
  averageTurnaroundDays: number;
  ucp600ComplianceRate: number;
  amendmentRate: number;
  discrepancyRate: number;
  statusDistribution: Record<LetterOfCreditStatus, number>;
}
