import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
} from 'class-validator';

export class GenerateDidDto {
  @IsString()
  @IsNotEmpty()
  stellarAddress: string;

  @IsOptional()
  @IsString()
  alias?: string;
}

export class IssueCredentialDto {
  @IsString()
  @IsNotEmpty()
  holderDid: string;

  @IsString()
  @IsNotEmpty()
  issuerName: string;

  @IsEnum(['TIER_1', 'TIER_2', 'TIER_3'])
  kycLevel: 'TIER_1' | 'TIER_2' | 'TIER_3';

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  accreditedInvestor?: boolean;

  @IsOptional()
  @IsArray()
  farmerCertifications?: string[];

  @IsOptional()
  expirationDays?: number;
}

export class PresentCredentialDto {
  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @IsArray()
  @IsString({ each: true })
  requestedAttributes: string[];

  @IsString()
  @IsNotEmpty()
  verifierDomain: string;

  @IsString()
  @IsNotEmpty()
  challenge: string;
}

export class RevokeCredentialDto {
  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
