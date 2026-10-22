import { run } from 'hardhat';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));

async function main() {
  const chainId = process.env.ETHEREUM_CHAIN_ID || '11155111';
  const manifest = JSON.parse(readFileSync(resolve(scriptDirectory, '..', 'deployments', `${chainId}.json`), 'utf8'));
  const addresses = [...new Set(Object.values(manifest.contracts as Record<string, { implementation: string }>).map((item) => item.implementation))];
  for (const address of addresses) await run('verify:verify', { address, constructorArguments: [] });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });