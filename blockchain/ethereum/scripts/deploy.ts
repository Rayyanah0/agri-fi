import { ethers, upgrades, run } from 'hardhat';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  if (process.env.ALLOW_UNAUDITED_DEPLOYMENT !== 'true') {
    throw new Error('Deployment blocked: set ALLOW_UNAUDITED_DEPLOYMENT=true only after external audit approval.');
  }
  const [admin] = await ethers.getSigners();
  const buyer = process.env.ESCROW_BUYER;
  const seller = process.env.ESCROW_SELLER;
  const arbitrator = process.env.ESCROW_ARBITRATOR;
  const asset = process.env.ESCROW_TOKEN;
  if (!buyer || !seller || !arbitrator || !asset) throw new Error('ESCROW_BUYER, ESCROW_SELLER, ESCROW_ARBITRATOR, and ESCROW_TOKEN are required.');

  const factory = await ethers.getContractFactory('DealEscrow');
  const escrowAmount = BigInt(process.env.ESCROW_AMOUNT || '1');
  const milestoneAmounts = (process.env.MILESTONE_AMOUNTS || '').split(',').filter(Boolean).map((amount) => BigInt(amount));
  if (milestoneAmounts.length === 0 || milestoneAmounts.reduce((sum, amount) => sum + amount, 0n) !== escrowAmount) {
    throw new Error('MILESTONE_AMOUNTS must be supplied and sum exactly to ESCROW_AMOUNT in token base units.');
  }
  const records: Record<string, { proxy: string; implementation: string }> = {};
  const templates: Array<{ name: string; mode: number; milestones: bigint[] }> = [
    { name: 'simple', mode: 0, milestones: [] },
    { name: 'milestone', mode: 1, milestones: milestoneAmounts },
    { name: 'dispute', mode: 2, milestones: [] },
  ];
  for (const { name, mode, milestones } of templates) {
    const proxy = await upgrades.deployProxy(factory, [admin.address, buyer, seller, arbitrator, asset, escrowAmount, 30 * 24 * 60 * 60, milestones, mode], { kind: 'uups' });
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    records[name] = { proxy: proxyAddress, implementation };
    console.log(`${name}: proxy=${proxyAddress}, implementation=${implementation}`);
  }

  const outputPath = resolve(process.cwd(), 'deployments', `${(await ethers.provider.getNetwork()).chainId}.json`);
  mkdirSync(resolve(process.cwd(), 'deployments'), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({ chainId: Number((await ethers.provider.getNetwork()).chainId), deployedAt: new Date().toISOString(), contracts: records }, null, 2));
  if (process.env.ETHERSCAN_API_KEY) {
    const implementationAddresses = [...new Set(Object.values(records).map((entry) => entry.implementation))];
    for (const address of implementationAddresses) {
      await run('verify:verify', { address, constructorArguments: [] });
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });