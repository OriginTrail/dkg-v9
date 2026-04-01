import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

import { PublishingConvictionAccount, Hub, Chronos, Token } from '../../typechain';

type Fixture = {
  accounts: SignerWithAddress[];
  Hub: Hub;
  PCA: PublishingConvictionAccount;
  Chronos: Chronos;
  Token: Token;
};

describe('@unit PCA coverPublishingCost', function () {
  let accounts: SignerWithAddress[];
  let Hub: Hub;
  let PCA: PublishingConvictionAccount;
  let ChronosContract: Chronos;
  let Token: Token;

  async function deployFixture(): Promise<Fixture> {
    await hre.deployments.fixture(['PublishingConvictionAccount']);
    const Hub = await hre.ethers.getContract<Hub>('Hub');
    const PCA = await hre.ethers.getContract<PublishingConvictionAccount>(
      'PublishingConvictionAccount',
    );
    const ChronosContract = await hre.ethers.getContract<Chronos>('Chronos');
    const Token = await hre.ethers.getContract<Token>('Token');
    const accounts = await hre.ethers.getSigners();
    await Hub.setContractAddress('HubOwner', accounts[0].address);

    // Register accounts[10] as "KnowledgeAssets" for unit testing
    await Hub.setContractAddress('KnowledgeAssets', accounts[10].address);

    // Re-initialize PCA so it approves the KA address for token pulls
    const pcaAddress = await PCA.getAddress();
    const initData = PCA.interface.encodeFunctionData('initialize');
    await Hub.forwardCall(pcaAddress, initData);

    return { accounts, Hub, PCA, Chronos: ChronosContract, Token };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({ accounts, Hub, PCA, Chronos: ChronosContract, Token } =
      await loadFixture(deployFixture));
  });

  const e = hre.ethers.parseEther;

  // Helper: create a PCA account and return the accountId
  async function createPCAAccount(admin: SignerWithAddress, amount: bigint): Promise<number> {
    await Token.mint(admin.address, amount);
    await Token.connect(admin).approve(await PCA.getAddress(), amount);
    await PCA.connect(admin).createAccount(amount);
    return Number(await PCA.nextAccountId()) - 1;
  }

  // Helper: call coverPublishingCost as the registered KA (accounts[10])
  function coverCostAsKA(accountId: number, baseCost: bigint, publisher: string) {
    return PCA.connect(accounts[10]).coverPublishingCost(accountId, baseCost, publisher);
  }

  // ========================================================================
  // Access control
  // ========================================================================

  describe('access control', () => {
    it('reverts with OnlyKnowledgeAssets when called by a random address', async () => {
      const accountId = await createPCAAccount(accounts[0], e('100000'));

      await expect(
        PCA.connect(accounts[0]).coverPublishingCost(accountId, e('100'), accounts[0].address),
      ).to.be.revertedWithCustomError(PCA, 'OnlyKnowledgeAssets');
    });

    it('reverts with NotAuthorizedKey when publisher is not authorized', async () => {
      const accountId = await createPCAAccount(accounts[0], e('100000'));

      await expect(
        coverCostAsKA(accountId, e('100'), accounts[5].address),
      ).to.be.revertedWithCustomError(PCA, 'NotAuthorizedKey');
    });

    it('succeeds when called by KnowledgeAssets with authorized key', async () => {
      const accountId = await createPCAAccount(accounts[0], e('100000'));

      await expect(coverCostAsKA(accountId, e('100'), accounts[0].address)).to.not.be.reverted;
    });

    it('succeeds with a non-admin authorized key', async () => {
      const accountId = await createPCAAccount(accounts[0], e('100000'));
      await PCA.addAuthorizedKey(accountId, accounts[1].address);

      await expect(coverCostAsKA(accountId, e('100'), accounts[1].address)).to.not.be.reverted;
    });
  });

  // ========================================================================
  // Locked balance deduction (discounted rate)
  // ========================================================================

  describe('locked balance deduction (discounted rate)', () => {
    it('deducts 700 TRAC from locked for 1000 baseCost at 30% discount (100K account)', async () => {
      const commitment = e('100000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      await coverCostAsKA(accountId, e('1000'), accounts[0].address);

      const info = await PCA.getAccountInfo(accountId);
      // 30% discount → discountedCost = 1000 * 7000/10000 = 700
      expect(info.lockedBalance).to.equal(commitment - e('700'));
    });

    it('deducts 2500 TRAC from locked for 10000 baseCost at 75% discount (1M account)', async () => {
      const commitment = e('1000000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      await coverCostAsKA(accountId, e('10000'), accounts[0].address);

      const info = await PCA.getAccountInfo(accountId);
      // 75% discount → discountedCost = 10000 * 2500/10000 = 2500
      expect(info.lockedBalance).to.equal(commitment - e('2500'));
    });

    it('deducts full baseCost from locked when account has 0% discount (10K)', async () => {
      const commitment = e('10000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      await coverCostAsKA(accountId, e('100'), accounts[0].address);

      const info = await PCA.getAccountInfo(accountId);
      // 0% discount → full rate from locked
      expect(info.lockedBalance).to.equal(commitment - e('100'));
    });

    it('returns 0 and deducts nothing when baseCost is 0', async () => {
      const commitment = e('100000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      await coverCostAsKA(accountId, 0n, accounts[0].address);

      const info = await PCA.getAccountInfo(accountId);
      expect(info.lockedBalance).to.equal(commitment);
    });
  });

  // ========================================================================
  // Return value and event
  // ========================================================================

  describe('return value and event', () => {
    it('emits PublishingCostCovered with correct actualDeducted', async () => {
      const accountId = await createPCAAccount(accounts[0], e('100000'));

      await expect(coverCostAsKA(accountId, e('1000'), accounts[0].address))
        .to.emit(PCA, 'PublishingCostCovered')
        .withArgs(accountId, accounts[0].address, e('1000'), e('700'));
    });

    it('emits with full baseCost as actualDeducted for 0% discount', async () => {
      const accountId = await createPCAAccount(accounts[0], e('10000'));

      await expect(coverCostAsKA(accountId, e('100'), accounts[0].address))
        .to.emit(PCA, 'PublishingCostCovered')
        .withArgs(accountId, accounts[0].address, e('100'), e('100'));
    });
  });

  // ========================================================================
  // TopUp fallback (full rate)
  // ========================================================================

  describe('topUp fallback (full rate)', () => {
    it('uses topUp at full rate when locked is exhausted', async () => {
      // 75% discount (1M account): locked covers baseCost / 4 from locked
      // Lock 1M, top up 2M, spend baseCost = 5M
      // discountedCost = 5M * 0.25 = 1.25M > locked (1M) → partial
      // lockedUsed = 1M, coveredBaseCost = 1M * 10000/2500 = 4M
      // remaining = 5M - 4M = 1M from topUp
      const commitment = e('1000000');
      const topUpAmount = e('2000000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      await Token.mint(accounts[0].address, topUpAmount);
      await Token.connect(accounts[0]).approve(await PCA.getAddress(), topUpAmount);
      await PCA.topUp(accountId, topUpAmount);

      await coverCostAsKA(accountId, e('5000000'), accounts[0].address);

      const info = await PCA.getAccountInfo(accountId);
      expect(info.lockedBalance).to.equal(0);
      expect(info.topUpBalance).to.equal(topUpAmount - e('1000000'));
    });

    it('emits correct totalDeducted for mixed locked+topUp', async () => {
      const commitment = e('1000000');
      const topUpAmount = e('2000000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      await Token.mint(accounts[0].address, topUpAmount);
      await Token.connect(accounts[0]).approve(await PCA.getAddress(), topUpAmount);
      await PCA.topUp(accountId, topUpAmount);

      // totalDeducted = lockedUsed + topUpUsed = 1M + 1M = 2M
      await expect(coverCostAsKA(accountId, e('5000000'), accounts[0].address))
        .to.emit(PCA, 'PublishingCostCovered')
        .withArgs(accountId, accounts[0].address, e('5000000'), e('2000000'));
    });

    it('uses only topUp when locked is already zero', async () => {
      // Create 1M account, drain locked completely, then publish from topUp
      const commitment = e('1000000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      // Drain locked: with 75% discount, each baseCost unit costs 0.25 from locked
      // To drain 1M locked: baseCost = 1M / 0.25 = 4M
      await coverCostAsKA(accountId, e('4000000'), accounts[0].address);

      const infoDrained = await PCA.getAccountInfo(accountId);
      expect(infoDrained.lockedBalance).to.equal(0);

      // Top up
      const topUpAmount = e('500000');
      await Token.mint(accounts[0].address, topUpAmount);
      await Token.connect(accounts[0]).approve(await PCA.getAddress(), topUpAmount);
      await PCA.topUp(accountId, topUpAmount);

      // Publish from topUp only — full rate
      await coverCostAsKA(accountId, e('1000'), accounts[0].address);

      const info = await PCA.getAccountInfo(accountId);
      expect(info.lockedBalance).to.equal(0);
      expect(info.topUpBalance).to.equal(topUpAmount - e('1000'));
    });
  });

  // ========================================================================
  // Insufficient balance
  // ========================================================================

  describe('insufficient balance', () => {
    it('reverts with InsufficientBalance when locked + topUp cannot cover baseCost', async () => {
      const commitment = e('100000'); // 30% discount
      const accountId = await createPCAAccount(accounts[0], commitment);

      // Max baseCost covered by locked only: 100K / 0.7 = ~142857
      // Any baseCost above that with no topUp should revert
      await expect(
        coverCostAsKA(accountId, e('200000'), accounts[0].address),
      ).to.be.revertedWithCustomError(PCA, 'InsufficientBalance');
    });

    it('reverts when topUp insufficient for remainder', async () => {
      const commitment = e('1000000'); // 75% discount
      const topUpAmount = e('100000');
      const accountId = await createPCAAccount(accounts[0], commitment);

      await Token.mint(accounts[0].address, topUpAmount);
      await Token.connect(accounts[0]).approve(await PCA.getAddress(), topUpAmount);
      await PCA.topUp(accountId, topUpAmount);

      // baseCost = 6M → discountedCost = 1.5M > locked (1M)
      // lockedUsed = 1M, coveredBaseCost = 4M, remaining = 2M
      // topUp = 100K < 2M → revert
      await expect(
        coverCostAsKA(accountId, e('6000000'), accounts[0].address),
      ).to.be.revertedWithCustomError(PCA, 'InsufficientBalance');
    });
  });

  // ========================================================================
  // Account not found
  // ========================================================================

  describe('error paths', () => {
    it('reverts with AccountNotFound for nonexistent accountId', async () => {
      await expect(
        coverCostAsKA(999, e('100'), accounts[0].address),
      ).to.be.revertedWithCustomError(PCA, 'AccountNotFound');
    });
  });
});
