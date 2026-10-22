export interface DidDocument {
  id: string; // e.g. "did:stellar:GA2MOCK..."
  '@context': string[];
  verificationMethod: {
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
    publicKeyHex?: string;
  }[];
  authentication: string[];
  assertionMethod: string[];
  created: string;
  updated: string;
}

export interface KycCredentialSubject {
  id: string; // Holder DID
  fullName?: string;
  nationalIdHash?: string;
  dateOfBirth?: string;
  country?: string;
  accreditedInvestor?: boolean;
  jurisdictionTier?: string;
  kycLevel: 'TIER_1' | 'TIER_2' | 'TIER_3';
  farmerCertifications?: string[];
  issuanceTimestamp: number;
}

export interface VerifiableCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: {
    id: string; // Issuer DID
    name: string;
  };
  issuanceDate: string;
  expirationDate: string;
  credentialSubject: KycCredentialSubject;
  credentialStatus: {
    id: string;
    type: 'StatusList2021' | 'OnChainRegistry';
    statusListIndex?: number;
    revocationHash?: string;
  };
  proof: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    jws?: string;
    hashAnchor: string; // On-chain Stellar hash anchor
  };
}

export interface VerifiablePresentation {
  '@context': string[];
  id: string;
  type: string[];
  verifiableCredential: VerifiableCredential[];
  holder: string;
  disclosedAttributes: string[];
  proof: {
    type: string;
    created: string;
    challenge: string;
    domain: string;
    signature: string;
  };
}
