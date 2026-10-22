import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { BiometricModality } from '../entities/biometric-credential.entity';

export class BiometricEnrollDto {
  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @IsString()
  @IsNotEmpty()
  publicKey: string;

  @IsOptional()
  @IsString()
  deviceName?: string;

  @IsOptional()
  @IsEnum(['fingerprint', 'facial', 'voice'])
  biometricType?: BiometricModality;

  @IsOptional()
  @IsString()
  aaguid?: string;
}

export class BiometricVerifyDto {
  @IsString()
  @IsNotEmpty()
  credentialId: string;

  @IsString()
  @IsNotEmpty()
  signature: string;

  @IsString()
  @IsNotEmpty()
  clientDataJson: string;

  @IsNumber()
  signCount: number;
}
