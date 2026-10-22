import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsArray,
} from 'class-validator';
import { LcType, Ucp600DocumentType } from '../letter-of-credit.types';

export class CreateLetterOfCreditDto {
  @ApiProperty({ description: 'Trade deal ID to issue LC for' })
  @IsString()
  dealId: string;

  @ApiProperty({
    description: 'Issuing bank BIC or name',
    example: 'STANDARD_CHARTERED_KE',
  })
  @IsString()
  issuingBank: string;

  @ApiProperty({
    description: 'Advising bank BIC or name',
    example: 'BARCLAYS_UK',
  })
  @IsString()
  advisingBank: string;

  @ApiProperty({
    description: 'Letter of credit type',
    enum: [
      'IRREVOCABLE_TRANSFERABLE',
      'IRREVOCABLE_CONFIRMED',
      'STANDBY',
      'REVOLVING',
    ],
    default: 'IRREVOCABLE_CONFIRMED',
  })
  @IsOptional()
  @IsEnum([
    'IRREVOCABLE_TRANSFERABLE',
    'IRREVOCABLE_CONFIRMED',
    'STANDBY',
    'REVOLVING',
  ])
  lcType?: LcType;

  @ApiProperty({
    description: 'Tolerance percentage under UCP 600 Article 30',
    default: 5,
  })
  @IsOptional()
  @IsNumber()
  tolerancePercentage?: number;

  @ApiProperty({
    description: 'Presentation window in days from shipment date',
    default: 21,
  })
  @IsOptional()
  @IsNumber()
  presentationPeriodDays?: number;

  @ApiProperty({
    description: 'Port of loading / departure',
    example: 'Port of Mombasa, Kenya',
  })
  @IsOptional()
  @IsString()
  portOfLoading?: string;

  @ApiProperty({
    description: 'Port of discharge / arrival',
    example: 'Port of Rotterdam, Netherlands',
  })
  @IsOptional()
  @IsString()
  portOfDischarge?: string;

  @ApiProperty({
    description: 'Required UCP 600 shipping and commercial documents',
    type: [String],
    example: [
      'BILL_OF_LADING',
      'COMMERCIAL_INVOICE',
      'CERTIFICATE_OF_ORIGIN',
      'INSURANCE_CERTIFICATE',
    ],
  })
  @IsOptional()
  @IsArray()
  requiredDocuments?: Ucp600DocumentType[];
}

export class AmendLetterOfCreditDto {
  @ApiProperty({
    description: 'Proposed modifications to LC parameters',
    example: { amount: 65000, expiryDate: '2026-12-31' },
  })
  proposedChanges: Record<string, any>;

  @ApiProperty({
    description: 'Rationale or amendment justification',
    example: 'Extend delivery date by 14 days due to port congestion',
  })
  @IsString()
  reason: string;
}

export class VerifyDocumentDto {
  @ApiProperty({
    description: 'Type of presented document',
    enum: [
      'BILL_OF_LADING',
      'COMMERCIAL_INVOICE',
      'CERTIFICATE_OF_ORIGIN',
      'PHYTOSANITARY_CERTIFICATE',
      'INSURANCE_CERTIFICATE',
      'PACKING_LIST',
      'INSPECTION_CERTIFICATE',
    ],
  })
  @IsEnum([
    'BILL_OF_LADING',
    'COMMERCIAL_INVOICE',
    'CERTIFICATE_OF_ORIGIN',
    'PHYTOSANITARY_CERTIFICATE',
    'INSURANCE_CERTIFICATE',
    'PACKING_LIST',
    'INSPECTION_CERTIFICATE',
  ])
  docType: Ucp600DocumentType;

  @ApiProperty({
    description: 'Official document number or tracking ID',
    example: 'BOL-MSA-2026-991',
  })
  @IsString()
  documentNumber: string;

  @ApiProperty({ description: 'Document issuance date', example: '2026-06-15' })
  @IsString()
  issueDate: string;

  @ApiProperty({
    description: 'IPFS or secure document URL',
    example: 'https://ipfs.io/ipfs/Qm...',
  })
  @IsString()
  documentUrl: string;

  @ApiProperty({
    description: 'Document SHA-256 fingerprint hash',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @IsString()
  documentHash: string;

  @ApiProperty({
    description: 'Commercial value or insured value if applicable',
    required: false,
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  statedAmount?: number;
}
