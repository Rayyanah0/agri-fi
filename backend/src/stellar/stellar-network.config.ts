import { Logger } from '@nestjs/common';

export enum StellarNetworkType {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
}

export interface NetworkConfig {
  network: StellarNetworkType;
  horizonUrls: string[];
  passphrase: string;
  friendbotUrl?: string;
  logPrefix: string;
  baseFee: number;
  baseReserve: number;
}

export const MAINNET_CONFIG: NetworkConfig = {
  network: StellarNetworkType.MAINNET,
  horizonUrls: [
    'https://horizon.stellar.org',
    'https://horizon-backup.stellar.org',
  ],
  passphrase: 'Public Global Stellar Network ; September 2015',
  logPrefix: '[MAINNET]',
  baseFee: 100,
  baseReserve: 0.5,
};

export const TESTNET_CONFIG: NetworkConfig = {
  network: StellarNetworkType.TESTNET,
  horizonUrls: [
    'https://horizon-testnet.stellar.org',
  ],
  passphrase: 'Test SDF Network ; September 2015',
  friendbotUrl: 'https://friendbot.stellar.org',
  logPrefix: '[TESTNET]',
  baseFee: 100,
  baseReserve: 0.5,
};

export class StellarNetworkManager {
  private static readonly logger = new Logger(StellarNetworkManager.name);

  static getActiveConfig(networkEnv?: string): NetworkConfig {
    const selected = (networkEnv || process.env.STELLAR_NETWORK || 'testnet').toLowerCase();

    if (selected === 'mainnet') {
      this.logger.warn(`${MAINNET_CONFIG.logPrefix} Connecting to Stellar Mainnet. Ensure secure KMS key storage is configured.`);
      return MAINNET_CONFIG;
    }

    this.logger.log(`${TESTNET_CONFIG.logPrefix} Operating on Stellar Testnet.`);
    return TESTNET_CONFIG;
  }

  static getLogPrefix(network: StellarNetworkType): string {
    return network === StellarNetworkType.MAINNET ? '[MAINNET]' : '[TESTNET]';
  }
}
