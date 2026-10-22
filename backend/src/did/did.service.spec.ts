import { Test, TestingModule } from '@nestjs/testing';
import { DidService } from './did.service';

describe('DidService', () => {
  let service: DidService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DidService],
    }).compile();

    service = module.get<DidService>(DidService);
  });

  it('should generate a valid W3C compliant DID document for Stellar', () => {
    const stellarAddress =
      'GA2MOCKTESTERWALLET1234567890ABCDEF1234567890ABCDEF1234';
    const didDoc = service.generateDid({ stellarAddress });

    expect(didDoc.id).toBe(`did:stellar:${stellarAddress}`);
    expect(didDoc.verificationMethod[0].controller).toBe(didDoc.id);
    expect(didDoc.authentication[0]).toBe(`${didDoc.id}#keys-1`);
  });

  it('should issue a KYC verifiable credential with on-chain hash anchor', () => {
    const holderDid =
      'did:stellar:GAHOLDER999999999999999999999999999999999999';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Agri-Fi Cooperative Central Bank',
      kycLevel: 'TIER_2',
      country: 'NG',
      accreditedInvestor: true,
    });

    expect(cred.id).toMatch(/^urn:uuid:/);
    expect(cred.issuer.name).toBe('Agri-Fi Cooperative Central Bank');
    expect(cred.credentialSubject.id).toBe(holderDid);
    expect(cred.proof.hashAnchor).toBeDefined();
    expect(cred.proof.hashAnchor.length).toBe(64); // SHA-256 length
  });

  it('should create a selective disclosure presentation concealing unrequested fields', () => {
    const holderDid =
      'did:stellar:GAHOLDER999999999999999999999999999999999999';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Ministry of Agriculture',
      kycLevel: 'TIER_3',
      country: 'GH',
      accreditedInvestor: false,
    });

    // Request only kycLevel and country
    const presentation = service.presentCredential({
      credentialId: cred.id,
      requestedAttributes: ['kycLevel', 'country'],
      verifierDomain: 'marketplace.agrifi.io',
      challenge: 'random-auth-challenge-12345',
    });

    expect(presentation.holder).toBe(holderDid);
    expect(
      presentation.verifiableCredential[0].credentialSubject.kycLevel,
    ).toBe('TIER_3');
    expect(presentation.verifiableCredential[0].credentialSubject.country).toBe(
      'GH',
    );
    // Ensure unrequested sensitive PII is not included
    expect(
      presentation.verifiableCredential[0].credentialSubject.nationalIdHash,
    ).toBeUndefined();

    // Verification check
    const verification = service.verifyPresentation(presentation);
    expect(verification.valid).toBe(true);
    expect(verification.disclosedAttributes).toEqual(['kycLevel', 'country']);
  });

  it('should reject presentations of revoked credentials', () => {
    const holderDid = 'did:stellar:GAHOLDERREVOKE';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Agri-Fi ID Service',
      kycLevel: 'TIER_1',
    });

    service.revokeCredential({
      credentialId: cred.id,
      reason: 'Identity document reported fraudulent',
    });

    const status = service.getCredentialStatus(cred.id);
    expect(status.revoked).toBe(true);

    expect(() => {
      service.presentCredential({
        credentialId: cred.id,
        requestedAttributes: ['kycLevel'],
        verifierDomain: 'portal.agrifi.io',
        challenge: 'test-challenge',
      });
    }).toThrow('has been revoked');
  });

  it('should emit renewal warnings for credentials nearing expiration', () => {
    const holderDid = 'did:stellar:GAHOLDEREXPIRING';
    const cred = service.issueCredential({
      holderDid,
      issuerName: 'Agri-Fi ID Service',
      kycLevel: 'TIER_1',
      expirationDays: 15, // Expires in 15 days
    });

    const presentation = service.presentCredential({
      credentialId: cred.id,
      requestedAttributes: ['kycLevel'],
      verifierDomain: 'portal.agrifi.io',
      challenge: 'test-challenge',
    });

    const verification = service.verifyPresentation(presentation);
    expect(verification.valid).toBe(true);
    expect(verification.warnings).toBeDefined();
    expect(verification.warnings![0]).toContain('expires soon');
  });
});
