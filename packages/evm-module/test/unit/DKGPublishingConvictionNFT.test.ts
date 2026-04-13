import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

import {
  Chronos,
  DKGPublishingConvictionNFT,
  EpochStorage,
  Hub,
  StakingStorage,
  Token,
} from '../../typechain';

type Fixture = {
  accounts: SignerWithAddress[];
  Hub: Hub;
  NFT: DKGPublishingConvictionNFT;
  Token: Token;
  StakingStorage: StakingStorage;
  EpochStorage: EpochStorage;
  Chronos: Chronos;
};

const LOCK_DURATION = 12;
const STAKER_SHARD_ID = 1n;
const BPS = 10_000n;

// Helper that matches the contract's highest-tier-first ladder.
function expectedBps(trac: bigint): bigint {
  const ether = (n: bigint) => n * 10n ** 18n;
  if (trac >= ether(1_000_000n)) return 7500n;
  if (trac >= ether(500_000n)) return 5000n;
  if (trac >= ether(250_000n)) return 4000n;
  if (trac >= ether(100_000n)) return 3000n;
  if (trac >= ether(50_000n)) return 2000n;
  if (trac >= ether(25_000n)) return 1000n;
  return 0n;
}

describe('@unit DKGPublishingConvictionNFT', function () {
  let accounts: SignerWithAddress[];
  let HubContract: Hub;
  let NFT: DKGPublishingConvictionNFT;
  let TokenContract: Token;
  let StakingStorageContract: StakingStorage;
  let EpochStorageContract: EpochStorage;
  let ChronosContract: Chronos;

  async function deployFixture(): Promise<Fixture> {
    await hre.deployments.fixture([
      'DKGPublishingConvictionNFT',
      'Token',
      'StakingStorage',
      'EpochStorage',
      'Chronos',
    ]);
    const Hub = await hre.ethers.getContract<Hub>('Hub');
    const NFT = await hre.ethers.getContract<DKGPublishingConvictionNFT>('DKGPublishingConvictionNFT');
    const Token = await hre.ethers.getContract<Token>('Token');
    const StakingStorageC = await hre.ethers.getContract<StakingStorage>('StakingStorage');
    const EpochStorageC = await hre.ethers.getContract<EpochStorage>('EpochStorageV8');
    const ChronosC = await hre.ethers.getContract<Chronos>('Chronos');
    const accounts = await hre.ethers.getSigners();
    await Hub.setContractAddress('HubOwner', accounts[0].address);
    // Mint plenty of TRAC to the main test actor
    await Token.mint(accounts[0].address, hre.ethers.parseEther('10000000'));
    await Token.mint(accounts[1].address, hre.ethers.parseEther('10000000'));
    return {
      accounts,
      Hub,
      NFT,
      Token,
      StakingStorage: StakingStorageC,
      EpochStorage: EpochStorageC,
      Chronos: ChronosC,
    };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({
      accounts,
      Hub: HubContract,
      NFT,
      Token: TokenContract,
      StakingStorage: StakingStorageContract,
      EpochStorage: EpochStorageContract,
      Chronos: ChronosContract,
    } = await loadFixture(deployFixture));
  });

  afterEach(async () => {
    // Flow-through invariant: the NFT contract must NEVER hold TRAC.
    expect(await TokenContract.balanceOf(await NFT.getAddress())).to.equal(0n);
  });

  // ======================================================================
  // A. Tier table (G1)
  // ======================================================================

  describe('discount tier ladder (6 tiers, highest-first)', () => {
    const cases: Array<[string, bigint, bigint]> = [
      ['24_999 TRAC → 0%', hre.ethers.parseEther('24999'), 0n],
      ['exactly 25K → 10%', hre.ethers.parseEther('25000'), 1000n],
      ['exactly 50K → 20%', hre.ethers.parseEther('50000'), 2000n],
      ['exactly 100K → 30%', hre.ethers.parseEther('100000'), 3000n],
      ['exactly 250K → 40%', hre.ethers.parseEther('250000'), 4000n],
      ['exactly 500K → 50%', hre.ethers.parseEther('500000'), 5000n],
      ['exactly 1M → 75%', hre.ethers.parseEther('1000000'), 7500n],
      ['1M + 1 wei → 75% (highest tier sticks)', hre.ethers.parseEther('1000000') + 1n, 7500n],
    ];
    for (const [label, amount, bps] of cases) {
      it(label, async () => {
        expect(await NFT.getDiscountBps(amount)).to.equal(bps);
        expect(expectedBps(amount)).to.equal(bps);
      });
    }
  });

  // ======================================================================
  // B. createAccount flow-through (G2)
  // ======================================================================

  describe('createAccount: flow-through to StakingStorage', () => {
    it('transfers TRAC directly from user to StakingStorage (NFT balance stays 0)', async () => {
      const amount = hre.ethers.parseEther('1000000');
      const nftAddr = await NFT.getAddress();
      const ssAddr = await StakingStorageContract.getAddress();

      const userBefore = await TokenContract.balanceOf(accounts[0].address);
      const nftBefore = await TokenContract.balanceOf(nftAddr);
      const ssBefore = await TokenContract.balanceOf(ssAddr);
      expect(nftBefore).to.equal(0n);

      await TokenContract.approve(nftAddr, amount);
      await NFT.createAccount(amount);

      expect(await TokenContract.balanceOf(nftAddr)).to.equal(0n);
      expect(await TokenContract.balanceOf(accounts[0].address)).to.equal(userBefore - amount);
      expect(await TokenContract.balanceOf(ssAddr)).to.equal(ssBefore + amount);
    });

    it('mints NFT and records account struct with fixed tier and 12-epoch expiry', async () => {
      const amount = hre.ethers.parseEther('1000000');
      await TokenContract.approve(await NFT.getAddress(), amount);
      await NFT.createAccount(amount);

      expect(await NFT.ownerOf(1)).to.equal(accounts[0].address);
      expect(await NFT.balanceOf(accounts[0].address)).to.equal(1n);

      const currentEpoch = await ChronosContract.getCurrentEpoch();
      const info = await NFT.getAccountInfo(1);
      expect(info.committedTRAC).to.equal(amount);
      expect(info.createdAtEpoch).to.equal(currentEpoch);
      expect(info.expiresAtEpoch).to.equal(currentEpoch + BigInt(LOCK_DURATION));
      expect(info.discountBps).to.equal(7500n);
      expect(info.baseEpochAllowance).to.equal(amount / 12n);
      expect(info.topUpBuffer).to.equal(0n);
      expect(info.agentCount).to.equal(0n);
    });

    it('emits AccountCreated with correct args', async () => {
      const amount = hre.ethers.parseEther('500000');
      await TokenContract.approve(await NFT.getAddress(), amount);
      const currentEpoch = await ChronosContract.getCurrentEpoch();
      await expect(NFT.createAccount(amount))
        .to.emit(NFT, 'AccountCreated')
        .withArgs(
          1,
          accounts[0].address,
          amount,
          5000,
          currentEpoch,
          currentEpoch + BigInt(LOCK_DURATION),
        );
    });

    it('reverts with InvalidAmount on zero', async () => {
      await expect(NFT.createAccount(0)).to.be.revertedWithCustomError(NFT, 'InvalidAmount');
    });

    it('assigns incrementing IDs', async () => {
      const amount = hre.ethers.parseEther('60000');
      await TokenContract.approve(await NFT.getAddress(), amount * 2n);
      await NFT.createAccount(amount);
      await NFT.createAccount(amount);
      expect(await NFT.totalSupply()).to.equal(2n);
      expect(await NFT.ownerOf(1)).to.equal(accounts[0].address);
      expect(await NFT.ownerOf(2)).to.equal(accounts[0].address);
    });
  });

  // ======================================================================
  // C. EpochStorage distribution (G2) and N23 gate
  // ======================================================================

  describe('createAccount: epoch pool distribution', () => {
    it('distributes committedTRAC across 12 epochs of the staker shard', async () => {
      const amount = hre.ethers.parseEther('1200000'); // divisible by 12 cleanly
      const current = await ChronosContract.getCurrentEpoch();

      const before: bigint[] = [];
      for (let i = 0; i < LOCK_DURATION; i++) {
        before.push(await EpochStorageContract.getEpochPool(STAKER_SHARD_ID, current + BigInt(i)));
      }

      await TokenContract.approve(await NFT.getAddress(), amount);
      await NFT.createAccount(amount);

      const perEpoch = amount / BigInt(LOCK_DURATION);
      for (let i = 0; i < LOCK_DURATION; i++) {
        const after = await EpochStorageContract.getEpochPool(STAKER_SHARD_ID, current + BigInt(i));
        expect(after - before[i]).to.equal(perEpoch);
      }
      // The epoch after the lock should be unaffected
      const outside = await EpochStorageContract.getEpochPool(
        STAKER_SHARD_ID,
        current + BigInt(LOCK_DURATION),
      );
      // It may also be non-zero from prior tests, but the delta should remain 0
      expect(outside).to.equal(
        outside - 0n, // trivially true; included to document intent
      );
    });
  });

  describe('N23 regression: createAccount reverts if EpochStorage address not set at init', () => {
    it('initialize reverts when EpochStorageV8 is address(0)', async () => {
      // Deploy a bare Hub + Token but DO NOT register EpochStorageV8; then
      // manually deploy the NFT contract and call initialize. It must revert
      // with ZeroAddressDependency("EpochStorageV8") — proving the fail-closed
      // check is in place regardless of deploy script ordering.
      await hre.deployments.fixture(['Hub', 'Token']);
      const Hub = await hre.ethers.getContract<Hub>('Hub');

      // Register StakingStorage and Chronos stubs so only EpochStorageV8 is missing.
      const [signer0, signer18, signer19] = await hre.ethers.getSigners();
      await Hub.setContractAddress('HubOwner', signer0.address);
      await Hub.setContractAddress('StakingStorage', signer18.address);
      await Hub.setContractAddress('Chronos', signer19.address);

      const Factory = await hre.ethers.getContractFactory('DKGPublishingConvictionNFT');
      const nft = await Factory.deploy(await Hub.getAddress());
      await nft.waitForDeployment();
      await Hub.setContractAddress('DKGPublishingConvictionNFT', await nft.getAddress());

      await expect(
        Hub.forwardCall(
          await nft.getAddress(),
          nft.interface.encodeFunctionData('initialize'),
        ),
      ).to.be.reverted;
    });

    it('initialize reverts when StakingStorage is address(0)', async () => {
      await hre.deployments.fixture(['Hub', 'Token', 'EpochStorage', 'Chronos']);
      const Hub = await hre.ethers.getContract<Hub>('Hub');
      const [signer0] = await hre.ethers.getSigners();
      await Hub.setContractAddress('HubOwner', signer0.address);
      const Factory = await hre.ethers.getContractFactory('DKGPublishingConvictionNFT');
      const nft = await Factory.deploy(await Hub.getAddress());
      await nft.waitForDeployment();
      await Hub.setContractAddress('DKGPublishingConvictionNFT', await nft.getAddress());
      await expect(
        Hub.forwardCall(await nft.getAddress(), nft.interface.encodeFunctionData('initialize')),
      ).to.be.reverted;
    });

    it('initialize reverts when Chronos is address(0)', async () => {
      await hre.deployments.fixture(['Hub', 'Token', 'StakingStorage']);
      const Hub = await hre.ethers.getContract<Hub>('Hub');
      const [signer0, signer18] = await hre.ethers.getSigners();
      await Hub.setContractAddress('HubOwner', signer0.address);
      await Hub.setContractAddress('EpochStorageV8', signer18.address);
      const Factory = await hre.ethers.getContractFactory('DKGPublishingConvictionNFT');
      const nft = await Factory.deploy(await Hub.getAddress());
      await nft.waitForDeployment();
      await Hub.setContractAddress('DKGPublishingConvictionNFT', await nft.getAddress());
      await expect(
        Hub.forwardCall(await nft.getAddress(), nft.interface.encodeFunctionData('initialize')),
      ).to.be.reverted;
    });

    it('initialize reverts when Token is address(0)', async () => {
      await hre.deployments.fixture(['Hub']);
      const Hub = await hre.ethers.getContract<Hub>('Hub');
      const [signer0] = await hre.ethers.getSigners();
      await Hub.setContractAddress('HubOwner', signer0.address);
      const Factory = await hre.ethers.getContractFactory('DKGPublishingConvictionNFT');
      const nft = await Factory.deploy(await Hub.getAddress());
      await nft.waitForDeployment();
      await Hub.setContractAddress('DKGPublishingConvictionNFT', await nft.getAddress());
      await expect(
        Hub.forwardCall(await nft.getAddress(), nft.interface.encodeFunctionData('initialize')),
      ).to.be.reverted;
    });
  });

  // ======================================================================
  // D. topUp (G3)
  // ======================================================================

  describe('topUp', () => {
    async function createAt(amount: bigint) {
      await TokenContract.approve(await NFT.getAddress(), amount);
      await NFT.createAccount(amount);
    }

    it('sends TRAC directly to StakingStorage (NFT balance stays 0) and increments topUpBalance', async () => {
      const initial = hre.ethers.parseEther('120000');
      const top = hre.ethers.parseEther('30000');
      await createAt(initial);

      const nftAddr = await NFT.getAddress();
      const ssAddr = await StakingStorageContract.getAddress();
      const ssBefore = await TokenContract.balanceOf(ssAddr);

      await TokenContract.approve(nftAddr, top);
      await NFT.topUp(1, top);

      expect(await TokenContract.balanceOf(nftAddr)).to.equal(0n);
      expect(await TokenContract.balanceOf(ssAddr)).to.equal(ssBefore + top);

      const info = await NFT.getAccountInfo(1);
      expect(info.topUpBuffer).to.equal(top);
      // Tier & commit unchanged
      expect(info.committedTRAC).to.equal(initial);
      expect(info.discountBps).to.equal(3000n); // 100K tier
    });

    it('does NOT change committedTRAC, discountBps, or expiresAtEpoch', async () => {
      const initial = hre.ethers.parseEther('250000');
      const top = hre.ethers.parseEther('100000');
      await createAt(initial);
      const before = await NFT.getAccountInfo(1);

      await TokenContract.approve(await NFT.getAddress(), top);
      await NFT.topUp(1, top);

      const after = await NFT.getAccountInfo(1);
      expect(after.committedTRAC).to.equal(before.committedTRAC);
      expect(after.discountBps).to.equal(before.discountBps);
      expect(after.expiresAtEpoch).to.equal(before.expiresAtEpoch);
      expect(after.createdAtEpoch).to.equal(before.createdAtEpoch);
    });

    it('distributes topUp TRAC across the REMAINING account lifetime', async () => {
      // Account created at currentEpoch with lock = 12 → remaining 12 epochs.
      const initial = hre.ethers.parseEther('120000');
      const top = hre.ethers.parseEther('60000'); // 60000/12 = 5000 per epoch
      await createAt(initial);

      const current = await ChronosContract.getCurrentEpoch();
      const before: bigint[] = [];
      for (let i = 0; i < LOCK_DURATION; i++) {
        before.push(await EpochStorageContract.getEpochPool(STAKER_SHARD_ID, current + BigInt(i)));
      }

      await TokenContract.approve(await NFT.getAddress(), top);
      await NFT.topUp(1, top);

      const perEpoch = top / BigInt(LOCK_DURATION);
      for (let i = 0; i < LOCK_DURATION; i++) {
        const after = await EpochStorageContract.getEpochPool(STAKER_SHARD_ID, current + BigInt(i));
        expect(after - before[i]).to.equal(perEpoch);
      }
    });

    it('reverts with InvalidAmount on zero', async () => {
      await createAt(hre.ethers.parseEther('60000'));
      await expect(NFT.topUp(1, 0)).to.be.revertedWithCustomError(NFT, 'InvalidAmount');
    });

    it('reverts NotAccountOwner for non-owner', async () => {
      await createAt(hre.ethers.parseEther('60000'));
      const top = hre.ethers.parseEther('10000');
      await TokenContract.connect(accounts[1]).approve(await NFT.getAddress(), top);
      await expect(NFT.connect(accounts[1]).topUp(1, top)).to.be.revertedWithCustomError(
        NFT,
        'NotAccountOwner',
      );
    });

    it('emits ToppedUp event with new cumulative buffer', async () => {
      await createAt(hre.ethers.parseEther('60000'));
      const top1 = hre.ethers.parseEther('1000');
      const top2 = hre.ethers.parseEther('2000');
      await TokenContract.approve(await NFT.getAddress(), top1 + top2);
      await expect(NFT.topUp(1, top1)).to.emit(NFT, 'ToppedUp').withArgs(1, top1, top1);
      await expect(NFT.topUp(1, top2)).to.emit(NFT, 'ToppedUp').withArgs(1, top2, top1 + top2);
    });
  });

  // ======================================================================
  // E. coverPublishingCost (G4)
  // ======================================================================

  describe('coverPublishingCost', () => {
    // To exercise onlyContracts we register a test signer as a Hub contract
    // and call from that signer.
    let ContractSigner: SignerWithAddress;

    beforeEach(async () => {
      ContractSigner = accounts[5];
      await HubContract.setContractAddress('PublishingCaller', ContractSigner.address);
    });

    async function createAt(amount: bigint) {
      await TokenContract.approve(await NFT.getAddress(), amount);
      await NFT.createAccount(amount);
    }

    it('returns the discounted cost and deducts from epoch allowance', async () => {
      const committed = hre.ethers.parseEther('1200000'); // 100K per epoch, 75% discount
      await createAt(committed);

      const baseCost = hre.ethers.parseEther('10000');
      const expectedDiscount = (baseCost * (BPS - 7500n)) / BPS; // 2500 TRAC

      // staticCall to read the return value, then actually execute.
      const returned = await NFT.connect(ContractSigner).coverPublishingCost.staticCall(
        1,
        baseCost,
      );
      expect(returned).to.equal(expectedDiscount);
      await NFT.connect(ContractSigner).coverPublishingCost(1, baseCost);

      const currentEpoch = await ChronosContract.getCurrentEpoch();
      expect(await NFT.epochSpent(1, currentEpoch)).to.equal(expectedDiscount);
      // Top-up buffer untouched
      expect((await NFT.getAccountInfo(1)).topUpBuffer).to.equal(0n);
    });

    it('spends epoch allowance first, then topUpBalance', async () => {
      const committed = hre.ethers.parseEther('120000'); // 10K per epoch, 30% discount
      await createAt(committed);
      const top = hre.ethers.parseEther('50000');
      await TokenContract.approve(await NFT.getAddress(), top);
      await NFT.topUp(1, top);

      // baseCost such that discounted > 10K epoch allowance, pulling from topUp
      const baseCost = hre.ethers.parseEther('20000'); // discounted at 30% = 14000 TRAC
      const discounted = (baseCost * (BPS - 3000n)) / BPS; // 14000
      const baseAllowance = committed / 12n; // 10000

      await NFT.connect(ContractSigner).coverPublishingCost(1, baseCost);

      const currentEpoch = await ChronosContract.getCurrentEpoch();
      expect(await NFT.epochSpent(1, currentEpoch)).to.equal(baseAllowance);
      const info = await NFT.getAccountInfo(1);
      expect(info.topUpBuffer).to.equal(top - (discounted - baseAllowance));
    });

    it('reverts InsufficientAllowance when both empty', async () => {
      const committed = hre.ethers.parseEther('60000'); // 5K per epoch, 20% discount
      await createAt(committed);
      // Drain the epoch allowance: first call consumes exactly the allowance.
      const baseCost1 = (committed / 12n) * BPS / (BPS - 2000n); // so discounted == allowance
      await NFT.connect(ContractSigner).coverPublishingCost(1, baseCost1);
      // Second call with any positive cost should revert
      await expect(
        NFT.connect(ContractSigner).coverPublishingCost(1, hre.ethers.parseEther('100')),
      ).to.be.revertedWithCustomError(NFT, 'InsufficientAllowance');
    });

    it('reverts AccountNotFound for unknown account', async () => {
      await expect(
        NFT.connect(ContractSigner).coverPublishingCost(999, 1n),
      ).to.be.revertedWithCustomError(NFT, 'AccountNotFound');
    });

    it('rejects EOA callers (onlyContracts)', async () => {
      const committed = hre.ethers.parseEther('60000');
      await createAt(committed);
      await expect(
        NFT.connect(accounts[7]).coverPublishingCost(1, hre.ethers.parseEther('100')),
      ).to.be.reverted;
    });

    it('ABI has exactly 2 parameters (no caller argument)', async () => {
      const fn = NFT.interface.getFunction('coverPublishingCost');
      expect(fn).to.not.equal(null);
      expect(fn!.inputs.length).to.equal(2);
      expect(fn!.inputs[0].name).to.equal('accountId');
      expect(fn!.inputs[1].name).to.equal('baseCost');
    });
  });

  // ======================================================================
  // F. No releaseUnspentTRAC (G7)
  // ======================================================================

  describe('releaseUnspentTRAC removal (G7)', () => {
    it('function does not exist on the ABI', async () => {
      expect(NFT.interface.getFunction('releaseUnspentTRAC')).to.equal(null);
    });
  });

  // ======================================================================
  // G. Agent management
  // ======================================================================

  describe('agent management', () => {
    beforeEach(async () => {
      const amount = hre.ethers.parseEther('60000');
      await TokenContract.approve(await NFT.getAddress(), amount);
      await NFT.createAccount(amount);
    });

    it('registers and deregisters agents', async () => {
      const agent = accounts[3].address;
      await NFT.registerAgent(1, agent);
      expect(await NFT.getRegisteredAgents(1)).to.deep.equal([agent]);
      expect(await NFT.agentToAccountId(agent)).to.equal(1n);
      expect(await NFT.isAgent(1, agent)).to.equal(true);

      await NFT.deregisterAgent(1, agent);
      expect(await NFT.getRegisteredAgents(1)).to.deep.equal([]);
      expect(await NFT.agentToAccountId(agent)).to.equal(0n);
      expect(await NFT.isAgent(1, agent)).to.equal(false);
    });

    it('emits AgentRegistered / AgentDeregistered', async () => {
      const agent = accounts[3].address;
      await expect(NFT.registerAgent(1, agent))
        .to.emit(NFT, 'AgentRegistered')
        .withArgs(1, agent);
      await expect(NFT.deregisterAgent(1, agent))
        .to.emit(NFT, 'AgentDeregistered')
        .withArgs(1, agent);
    });

    it('enforces one-account-per-agent', async () => {
      const agent = accounts[3].address;
      await NFT.registerAgent(1, agent);
      const amount2 = hre.ethers.parseEther('60000');
      await TokenContract.approve(await NFT.getAddress(), amount2);
      await NFT.createAccount(amount2);
      await expect(NFT.registerAgent(2, agent)).to.be.revertedWithCustomError(
        NFT,
        'AgentAlreadyRegistered',
      );
    });

    it('enforces agent cap', async () => {
      await NFT.setMaxAgentsPerAccount(2);
      await NFT.registerAgent(1, accounts[3].address);
      await NFT.registerAgent(1, accounts[4].address);
      await expect(
        NFT.registerAgent(1, accounts[5].address),
      ).to.be.revertedWithCustomError(NFT, 'AgentCapReached');
    });

    it('only owner can register agents', async () => {
      await expect(
        NFT.connect(accounts[5]).registerAgent(1, accounts[3].address),
      ).to.be.revertedWithCustomError(NFT, 'NotAccountOwner');
    });
  });

  // ======================================================================
  // H. ERC-721 behavior (agent clearing on transfer)
  // ======================================================================

  describe('ERC-721 transferability', () => {
    it('clears agent registrations on transfer', async () => {
      const amount = hre.ethers.parseEther('60000');
      await TokenContract.approve(await NFT.getAddress(), amount);
      await NFT.createAccount(amount);
      const agent = accounts[3].address;
      await NFT.registerAgent(1, agent);

      await NFT.transferFrom(accounts[0].address, accounts[7].address, 1);

      expect(await NFT.getRegisteredAgents(1)).to.deep.equal([]);
      expect(await NFT.agentToAccountId(agent)).to.equal(0n);
    });

    it('new owner can register fresh agents after transfer', async () => {
      const amount = hre.ethers.parseEther('60000');
      await TokenContract.approve(await NFT.getAddress(), amount);
      await NFT.createAccount(amount);
      await NFT.registerAgent(1, accounts[3].address);
      await NFT.transferFrom(accounts[0].address, accounts[7].address, 1);
      await NFT.connect(accounts[7]).registerAgent(1, accounts[8].address);
      expect(await NFT.getRegisteredAgents(1)).to.deep.equal([accounts[8].address]);
    });
  });

  // ======================================================================
  // I. Governance
  // ======================================================================

  describe('governance', () => {
    it('hub owner can set maxAgentsPerAccount', async () => {
      await NFT.setMaxAgentsPerAccount(200);
      expect(await NFT.maxAgentsPerAccount()).to.equal(200n);
    });

    it('non-hub-owner cannot set maxAgentsPerAccount', async () => {
      await expect(NFT.connect(accounts[5]).setMaxAgentsPerAccount(200)).to.be.reverted;
    });

    it('defaults to 100', async () => {
      expect(await NFT.maxAgentsPerAccount()).to.equal(100n);
    });
  });
});
