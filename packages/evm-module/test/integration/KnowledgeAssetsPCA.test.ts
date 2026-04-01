import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'ethers';
import hre from 'hardhat';

import {
  KnowledgeAssets,
  KnowledgeAssetsStorage,
  EpochStorage,
  AskStorage,
  Chronos,
  Token,
  ParametersStorage,
  IdentityStorage,
  Hub,
  Profile,
  Identity,
  PublishingConvictionAccount,
} from '../../typechain';
import { signMessage } from '../helpers/kc-helpers';
import { createProfile, createProfiles } from '../helpers/profile-helpers';
import {
  getDefaultPublishingNode,
  getDefaultReceivingNodes,
  getDefaultKCCreator,
} from '../helpers/setup-helpers';

type PCAFixture = {
  accounts: SignerWithAddress[];
  Hub: Hub;
  KnowledgeAssets: KnowledgeAssets;
  KnowledgeAssetsStorage: KnowledgeAssetsStorage;
  EpochStorage: EpochStorage;
  AskStorage: AskStorage;
  Chronos: Chronos;
  Token: Token;
  ParametersStorage: ParametersStorage;
  IdentityStorage: IdentityStorage;
  Identity: Identity;
  Profile: Profile;
  PCA: PublishingConvictionAccount;
};

describe('@integration KnowledgeAssets + PCA', () => {
  let accounts: SignerWithAddress[];
  let Hub: Hub;
  let KA: KnowledgeAssets;
  let KAS: KnowledgeAssetsStorage;
  let ES: EpochStorage;
  let AS: AskStorage;
  let ChronosContract: Chronos;
  let Token: Token;
  let PS: ParametersStorage;
  let IS: IdentityStorage;
  let IdentityContract: Identity;
  let ProfileContract: Profile;
  let PCA: PublishingConvictionAccount;

  async function deployFixture(): Promise<PCAFixture> {
    await hre.deployments.fixture([
      'Token',
      'AskStorage',
      'EpochStorage',
      'Chronos',
      'Profile',
      'Identity',
      'Staking',
      'KnowledgeCollection',
      'ParanetKnowledgeCollectionsRegistry',
      'ParanetKnowledgeMinersRegistry',
      'ParanetsRegistry',
      'KnowledgeAssetsStorage',
      'KnowledgeAssets',
      'PublishingConvictionAccount',
    ]);

    const accounts = await hre.ethers.getSigners();
    const Hub = await hre.ethers.getContract<Hub>('Hub');
    const KnowledgeAssets = await hre.ethers.getContract<KnowledgeAssets>('KnowledgeAssets');
    const KnowledgeAssetsStorage =
      await hre.ethers.getContract<KnowledgeAssetsStorage>('KnowledgeAssetsStorage');
    const EpochStorage = await hre.ethers.getContract<EpochStorage>('EpochStorageV8');
    const AskStorage = await hre.ethers.getContract<AskStorage>('AskStorage');
    const Chronos = await hre.ethers.getContract<Chronos>('Chronos');
    const Token = await hre.ethers.getContract<Token>('Token');
    const ParametersStorage =
      await hre.ethers.getContract<ParametersStorage>('ParametersStorage');
    const IdentityStorage =
      await hre.ethers.getContract<IdentityStorage>('IdentityStorage');
    const Identity = await hre.ethers.getContract<Identity>('Identity');
    const Profile = await hre.ethers.getContract<Profile>('Profile');
    const PCA = await hre.ethers.getContract<PublishingConvictionAccount>(
      'PublishingConvictionAccount',
    );

    await Hub.setContractAddress('HubOwner', accounts[0].address);

    // Re-initialize PCA so it approves KA for token pulls
    const pcaAddr = await PCA.getAddress();
    const initData = PCA.interface.encodeFunctionData('initialize');
    await Hub.forwardCall(pcaAddr, initData);

    return {
      accounts,
      Hub,
      KnowledgeAssets,
      KnowledgeAssetsStorage,
      EpochStorage,
      AskStorage,
      Chronos,
      Token,
      ParametersStorage,
      IdentityStorage,
      Identity,
      Profile,
      PCA,
    };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({
      accounts,
      Hub,
      KnowledgeAssets: KA,
      KnowledgeAssetsStorage: KAS,
      EpochStorage: ES,
      AskStorage: AS,
      Chronos: ChronosContract,
      Token,
      ParametersStorage: PS,
      IdentityStorage: IS,
      Identity: IdentityContract,
      Profile: ProfileContract,
      PCA,
    } = await loadFixture(deployFixture));
  });

  const e = hre.ethers.parseEther;

  // ========================================================================
  // Helpers
  // ========================================================================

  async function buildSignatures(
    publishingNode: { admin: SignerWithAddress; operational: SignerWithAddress },
    pubId: number,
    receivingNodes: { admin: SignerWithAddress; operational: SignerWithAddress }[],
    merkleRoot: string,
    publicByteSize: number,
  ) {
    const pubMsgHash = ethers.solidityPackedKeccak256(
      ['uint72', 'bytes32'],
      [pubId, merkleRoot],
    );
    const { r: pubR, vs: pubVS } = await signMessage(publishingNode.operational, pubMsgHash);

    const receiverMsgHash = ethers.solidityPackedKeccak256(
      ['bytes32', 'uint64'],
      [merkleRoot, BigInt(publicByteSize)],
    );
    const receiverRs: string[] = [];
    const receiverVSs: string[] = [];
    for (const node of receivingNodes) {
      const { r, vs } = await signMessage(node.operational, receiverMsgHash);
      receiverRs.push(r);
      receiverVSs.push(vs);
    }

    return { pubR, pubVS, receiverRs, receiverVSs };
  }

  async function setupNodesAndAsk() {
    const publishingNode = getDefaultPublishingNode(accounts);
    const receivingNodes = getDefaultReceivingNodes(accounts);

    const { identityId: pubId } = await createProfile(ProfileContract, publishingNode);
    const receiverProfiles = await createProfiles(ProfileContract, receivingNodes);
    const receiverIds = receiverProfiles.map((p) => p.identityId);

    await AS.setWeightedActiveAskSum(e('1'));
    await AS.setTotalActiveStake(1);

    return { publishingNode, receivingNodes, pubId, receiverIds };
  }

  async function createPCAAccountForPublisher(
    publisher: SignerWithAddress,
    commitment: bigint,
  ): Promise<number> {
    await Token.mint(publisher.address, commitment);
    await Token.connect(publisher).approve(await PCA.getAddress(), commitment);
    await PCA.connect(publisher).createAccount(commitment);
    return Number(await PCA.nextAccountId()) - 1;
  }

  // ========================================================================
  // batchMintKnowledgeAssets with PCA
  // ========================================================================

  describe('batchMintKnowledgeAssets with PCA', () => {
    it('transfers discounted amount from PCA to StakingStorage', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      // Create PCA account for publisher (100K = 30% discount)
      const accountId = await createPCAAccountForPublisher(kcCreator, e('100000'));

      const byteSize = 2048;
      const epochs = 3;
      const ask = await AS.getStakeWeightedAverageAsk();
      const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;
      const discountedAmount = (tokenAmount * 7000n) / 10000n; // 30% discount

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('pca-mint-test'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      const stakingStorageAddr = await Hub.getContractAddress('StakingStorage');
      const balanceBefore = await Token.balanceOf(stakingStorageAddr);
      const pcaBalanceBefore = await Token.balanceOf(await PCA.getAddress());

      await KA.connect(kcCreator).batchMintKnowledgeAssets(
        pubId,
        merkleRoot,
        1,
        5,
        byteSize,
        epochs,
        tokenAmount,
        ethers.ZeroAddress,
        pubR,
        pubVS,
        receiverIds,
        receiverRs,
        receiverVSs,
        accountId, // PCA account
      );

      const balanceAfter = await Token.balanceOf(stakingStorageAddr);
      const pcaBalanceAfter = await Token.balanceOf(await PCA.getAddress());

      // StakingStorage received discounted amount
      expect(balanceAfter - balanceBefore).to.equal(discountedAmount);
      // PCA balance decreased by discounted amount
      expect(pcaBalanceBefore - pcaBalanceAfter).to.equal(discountedAmount);

      // PCA internal balance decreased
      const info = await PCA.getAccountInfo(accountId);
      expect(info.lockedBalance).to.equal(e('100000') - discountedAmount);
    });

    it('epoch pool receives discounted amount', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      const accountId = await createPCAAccountForPublisher(kcCreator, e('100000'));

      const byteSize = 2048;
      const epochs = 3;
      const ask = await AS.getStakeWeightedAverageAsk();
      const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;
      const discountedAmount = (tokenAmount * 7000n) / 10000n;

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('pca-epoch-test'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      await KA.connect(kcCreator).batchMintKnowledgeAssets(
        pubId,
        merkleRoot,
        1,
        5,
        byteSize,
        epochs,
        tokenAmount,
        ethers.ZeroAddress,
        pubR,
        pubVS,
        receiverIds,
        receiverRs,
        receiverVSs,
        accountId,
      );

      // Check epoch pool received the discounted amount (summed across epoch range)
      const currentEpoch = await ChronosContract.getCurrentEpoch();
      const totalPool = await ES.getEpochRangePool(
        1,
        currentEpoch,
        currentEpoch + BigInt(epochs),
      );
      expect(totalPool).to.equal(discountedAmount);
    });

    it('publisher does not pay TRAC directly (tokens come from PCA)', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      const accountId = await createPCAAccountForPublisher(kcCreator, e('100000'));

      const byteSize = 2048;
      const epochs = 3;
      const ask = await AS.getStakeWeightedAverageAsk();
      const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('pca-no-direct-pay'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      const publisherBalanceBefore = await Token.balanceOf(kcCreator.address);

      await KA.connect(kcCreator).batchMintKnowledgeAssets(
        pubId,
        merkleRoot,
        1,
        5,
        byteSize,
        epochs,
        tokenAmount,
        ethers.ZeroAddress,
        pubR,
        pubVS,
        receiverIds,
        receiverRs,
        receiverVSs,
        accountId,
      );

      const publisherBalanceAfter = await Token.balanceOf(kcCreator.address);
      // Publisher's own TRAC balance unchanged
      expect(publisherBalanceAfter).to.equal(publisherBalanceBefore);
    });

    it('reverts when publisher is not an authorized key on the PCA account', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      // Create PCA account for a DIFFERENT user (accounts[0])
      const accountId = await createPCAAccountForPublisher(accounts[0], e('100000'));

      const byteSize = 2048;
      const epochs = 3;
      const ask = await AS.getStakeWeightedAverageAsk();
      const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('pca-unauthorized'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      // kcCreator is NOT an authorized key on accounts[0]'s PCA account
      await expect(
        KA.connect(kcCreator).batchMintKnowledgeAssets(
          pubId,
          merkleRoot,
          1,
          5,
          byteSize,
          epochs,
          tokenAmount,
          ethers.ZeroAddress,
          pubR,
          pubVS,
          receiverIds,
          receiverRs,
          receiverVSs,
          accountId,
        ),
      ).to.be.revertedWithCustomError(PCA, 'NotAuthorizedKey');
    });

    it('works with convictionAccountId=0 (existing direct-pay flow)', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      const byteSize = 2048;
      const epochs = 3;
      const ask = await AS.getStakeWeightedAverageAsk();
      const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;

      await Token.mint(kcCreator.address, tokenAmount * 2n);
      const kaAddr = await KA.getAddress();
      await Token.connect(kcCreator).increaseAllowance(kaAddr, tokenAmount);

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('no-pca'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      const balanceBefore = await Token.balanceOf(kcCreator.address);

      await KA.connect(kcCreator).batchMintKnowledgeAssets(
        pubId,
        merkleRoot,
        1,
        5,
        byteSize,
        epochs,
        tokenAmount,
        ethers.ZeroAddress,
        pubR,
        pubVS,
        receiverIds,
        receiverRs,
        receiverVSs,
        0, // no PCA
      );

      const balanceAfter = await Token.balanceOf(kcCreator.address);
      expect(balanceBefore - balanceAfter).to.equal(tokenAmount);
    });
  });

  // ========================================================================
  // updateKnowledgeAssets with PCA
  // ========================================================================

  describe('updateKnowledgeAssets with PCA', () => {
    it('deducts update cost from PCA at discounted rate', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      // Create PCA account and mint initial batch using PCA
      const accountId = await createPCAAccountForPublisher(kcCreator, e('100000'));

      const byteSize = 2048;
      const epochs = 3;
      const ask = await AS.getStakeWeightedAverageAsk();
      const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('update-pca-test'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      await KA.connect(kcCreator).batchMintKnowledgeAssets(
        pubId,
        merkleRoot,
        1,
        5,
        byteSize,
        epochs,
        tokenAmount,
        ethers.ZeroAddress,
        pubR,
        pubVS,
        receiverIds,
        receiverRs,
        receiverVSs,
        accountId,
      );

      const batchId = await KAS.getLatestBatchId();
      const infoBefore = await PCA.getAccountInfo(accountId);

      // Update the batch using PCA
      const newMerkleRoot = ethers.keccak256(ethers.toUtf8Bytes('updated'));
      await KA.connect(kcCreator).updateKnowledgeAssets(
        batchId,
        newMerkleRoot,
        byteSize,
        accountId,
      );

      const infoAfter = await PCA.getAccountInfo(accountId);
      // Update cost is 10% of original → discounted by 30% from locked
      expect(infoAfter.lockedBalance).to.be.lt(infoBefore.lockedBalance);
    });
  });

  // ========================================================================
  // extendStorage with PCA
  // ========================================================================

  describe('extendStorage with PCA', () => {
    it('extends storage using PCA funds', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      const accountId = await createPCAAccountForPublisher(kcCreator, e('100000'));

      const byteSize = 2048;
      const epochs = 3;
      const ask = await AS.getStakeWeightedAverageAsk();
      const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('extend-pca-test'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      await KA.connect(kcCreator).batchMintKnowledgeAssets(
        pubId,
        merkleRoot,
        1,
        5,
        byteSize,
        epochs,
        tokenAmount,
        ethers.ZeroAddress,
        pubR,
        pubVS,
        receiverIds,
        receiverRs,
        receiverVSs,
        accountId,
      );

      const batchId = await KAS.getLatestBatchId();
      const batchBefore = await KAS.getBatch(batchId);
      const infoBefore = await PCA.getAccountInfo(accountId);

      // Extend storage using PCA
      const additionalEpochs = 2;
      const extensionCost = (ask * BigInt(byteSize) * BigInt(additionalEpochs)) / 1024n;

      await KA.connect(kcCreator).extendStorage(
        batchId,
        additionalEpochs,
        extensionCost,
        ethers.ZeroAddress,
        accountId,
      );

      const batchAfter = await KAS.getBatch(batchId);
      expect(batchAfter.endEpoch).to.equal(
        batchBefore.endEpoch + BigInt(additionalEpochs),
      );

      const infoAfter = await PCA.getAccountInfo(accountId);
      expect(infoAfter.lockedBalance).to.be.lt(infoBefore.lockedBalance);
    });
  });

  // ========================================================================
  // batchMintKnowledgeAssetsPermanent with PCA
  // ========================================================================

  describe('batchMintKnowledgeAssetsPermanent with PCA', () => {
    it('permanent publish using PCA funds at discounted rate', async () => {
      const kcCreator = getDefaultKCCreator(accounts);
      const { publishingNode, receivingNodes, pubId, receiverIds } =
        await setupNodesAndAsk();

      // Large PCA account for permanent publish cost
      const accountId = await createPCAAccountForPublisher(kcCreator, e('1000000'));

      const byteSize = 1024;
      const ask = await AS.getStakeWeightedAverageAsk();
      const annualCost = (ask * BigInt(byteSize) * 12n) / 1024n;
      const permanentCost = annualCost * 10n;
      const tokenAmount = permanentCost;
      const discountedAmount = (tokenAmount * 7000n) / 10000n; // 30% discount (100K+ threshold but we have 1M)

      await KA.connect(kcCreator).reserveUALRange(10);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('permanent-pca'));
      const { pubR, pubVS, receiverRs, receiverVSs } = await buildSignatures(
        publishingNode,
        pubId,
        receivingNodes,
        merkleRoot,
        byteSize,
      );

      const stakingStorageAddr = await Hub.getContractAddress('StakingStorage');
      const balanceBefore = await Token.balanceOf(stakingStorageAddr);

      await KA.connect(kcCreator).batchMintKnowledgeAssetsPermanent(
        5,
        pubId,
        merkleRoot,
        byteSize,
        tokenAmount,
        pubR,
        pubVS,
        receiverIds,
        receiverRs,
        receiverVSs,
        accountId,
      );

      const balanceAfter = await Token.balanceOf(stakingStorageAddr);
      // 1M commitment → 75% discount → discountedAmount = tokenAmount * 2500/10000
      const expectedDiscount = (tokenAmount * 2500n) / 10000n;
      expect(balanceAfter - balanceBefore).to.equal(expectedDiscount);
    });
  });
});
