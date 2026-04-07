#!/usr/bin/env npx tsx
import { ethers, JsonRpcProvider, Contract } from 'ethers';
import { writeFileSync } from 'node:fs';

// ── Minimal ABI fragments ──────────────────────────────────────────────

const HUB_ABI = [
  'function getContractAddress(string) view returns (address)',
];

const STAKING_STORAGE_ABI = [
  'function getTotalStake() view returns (uint96)',
  'function getNodeStake(uint72) view returns (uint96)',
  'function getDelegatorStakeBase(uint72, bytes32) view returns (uint96)',
];

const DELEGATORS_INFO_ABI = [
  'function getDelegators(uint72) view returns (address[])',
];

const CHRONOS_ABI = [
  'function getCurrentEpoch() view returns (uint256)',
];

const PROFILE_STORAGE_ABI = [
  'function getIdentityIdsLength() view returns (uint256)',
];

// ── CLI argument parsing ────────────────────────────────────────────────

function parseArgs(): { rpc: string; hub: string } {
  const args = process.argv.slice(2);
  let rpc = '';
  let hub = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rpc' && args[i + 1]) rpc = args[++i];
    else if (args[i] === '--hub' && args[i + 1]) hub = args[++i];
  }

  if (!rpc || !hub) {
    console.error('Usage: npx tsx scripts/epoch-snapshot.ts --rpc <url> --hub <address>');
    process.exit(1);
  }

  return { rpc, hub };
}

// ── Contract resolver ───────────────────────────────────────────────────

async function resolveContract(
  hub: Contract,
  name: string,
  abi: string[],
  provider: JsonRpcProvider,
): Promise<Contract> {
  const address: string = await hub.getContractAddress(name);
  if (address === ethers.ZeroAddress) {
    throw new Error(`Contract "${name}" not registered in Hub`);
  }
  return new Contract(address, abi, provider);
}

// ── Types ───────────────────────────────────────────────────────────────

interface DelegatorEntry {
  address: string;
  stakeBase: string;
}

interface NodeEntry {
  identityId: number;
  stake: string;
  delegators: DelegatorEntry[];
}

interface Snapshot {
  chainId: string;
  epoch: number;
  timestamp: string;
  hubAddress: string;
  totalStake: string;
  nodes: NodeEntry[];
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const { rpc, hub: hubAddress } = parseArgs();

  const provider = new JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  const chainId = network.chainId.toString();

  console.log(`Chain ID: ${chainId}`);
  console.log(`Hub:      ${hubAddress}`);

  const hub = new Contract(hubAddress, HUB_ABI, provider);

  // Resolve all required contracts from Hub
  const [stakingStorage, delegatorsInfo, chronos, profileStorage] = await Promise.all([
    resolveContract(hub, 'StakingStorage', STAKING_STORAGE_ABI, provider),
    resolveContract(hub, 'DelegatorsInfo', DELEGATORS_INFO_ABI, provider),
    resolveContract(hub, 'Chronos', CHRONOS_ABI, provider),
    resolveContract(hub, 'ProfileStorage', PROFILE_STORAGE_ABI, provider),
  ]);

  const epoch = Number(await chronos.getCurrentEpoch());
  const totalStake: bigint = await stakingStorage.getTotalStake();

  console.log(`Epoch:    ${epoch}`);
  console.log(`Total stake: ${ethers.formatEther(totalStake)} TRAC`);

  // Determine upper bound for identity iteration.
  // ProfileStorage.getIdentityIdsLength() gives the count; identity IDs are 1-based.
  // Fall back to consecutive-zero scanning if the call fails.
  let upperBound: number;
  try {
    upperBound = Number(await profileStorage.getIdentityIdsLength());
    console.log(`ProfileStorage identity count: ${upperBound}`);
  } catch {
    upperBound = 0;
  }

  const nodes: NodeEntry[] = [];
  let consecutiveZeros = 0;
  const MAX_CONSECUTIVE_ZEROS = 10;

  const limit = upperBound > 0 ? upperBound : 100_000;

  for (let id = 1; id <= limit; id++) {
    let stake: bigint;
    try {
      stake = await stakingStorage.getNodeStake(id);
    } catch {
      consecutiveZeros++;
      if (consecutiveZeros >= MAX_CONSECUTIVE_ZEROS) break;
      continue;
    }

    if (stake === 0n) {
      consecutiveZeros++;
      if (upperBound === 0 && consecutiveZeros >= MAX_CONSECUTIVE_ZEROS) break;
      continue;
    }
    consecutiveZeros = 0;

    // Fetch delegator list
    let delegatorAddresses: string[] = [];
    try {
      delegatorAddresses = await delegatorsInfo.getDelegators(id);
    } catch {
      // No delegators or contract reverted
    }

    // Fetch each delegator's stakeBase in parallel
    const delegators: DelegatorEntry[] = [];
    if (delegatorAddresses.length > 0) {
      const BATCH = 20;
      for (let i = 0; i < delegatorAddresses.length; i += BATCH) {
        const batch = delegatorAddresses.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(async (addr) => {
            const key = ethers.keccak256(ethers.solidityPacked(['address'], [addr]));
            let stakeBase = 0n;
            try {
              stakeBase = await stakingStorage.getDelegatorStakeBase(id, key);
            } catch {
              // Delegator may have fully withdrawn
            }
            return { address: addr, stakeBase: stakeBase.toString() } satisfies DelegatorEntry;
          }),
        );
        delegators.push(...results);
      }
    }

    nodes.push({
      identityId: id,
      stake: stake.toString(),
      delegators,
    });

    if (nodes.length % 25 === 0) {
      console.log(`  ...scanned ${id} identities, found ${nodes.length} staked nodes`);
    }
  }

  console.log(`\nFound ${nodes.length} staked nodes`);

  const snapshot: Snapshot = {
    chainId,
    epoch,
    timestamp: new Date().toISOString(),
    hubAddress,
    totalStake: totalStake.toString(),
    nodes,
  };

  const filename = `snapshot-${chainId}-${epoch}.json`;
  writeFileSync(filename, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`Wrote ${filename}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
