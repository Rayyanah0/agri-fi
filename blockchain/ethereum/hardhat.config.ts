import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';
import 'dotenv/config';

const privateKey = process.env.ETHEREUM_DEPLOYER_PRIVATE_KEY;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    sepolia: {
      url: process.env.ETHEREUM_RPC_URL || '',
      chainId: Number(process.env.ETHEREUM_CHAIN_ID || 11155111),
      accounts: privateKey ? [privateKey] : [],
    },
  },
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || '' },
};

export default config;