import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { ethers } from 'ethers';
import hre from 'hardhat';

import {
  KnowledgeAssets,
  KnowledgeAssetsStorage,
  KnowledgeCollection,
  KnowledgeCollectionStorage,
  EpochStorage,
  AskStorage,
  Chronos,
  Token,
  ParametersStorage,
  IdentityStorage,
  Hub,
  Profile,
  Identity,
  Staking,
} from '../../typechain';
import { signMessage } from '../helpers/kc-helpers';
import { createProfile, createProfiles } from '../helpers/profile-helpers';
import {
  getDefaultPublishingNode,
  getDefaultReceivingNodes,
  getDefaultKCCreator,
} from '../helpers/setup-helpers';

type V9Fixture = {
  accounts: SignerWithAddress[];
  Hub: Hub;
  KnowledgeAssets: KnowledgeAssets;
  KnowledgeAssetsStorage: KnowledgeAssetsStorage;
  KnowledgeCollection: KnowledgeCollection;
  KnowledgeCollectionStorage: KnowledgeCollectionStorage;
  EpochStorage: EpochStorage;
  AskStorage: AskStorage;
  Chronos: Chronos;
  Token: Token;
  ParametersStorage: ParametersStorage;
  IdentityStorage: IdentityStorage;
  Identity: Identity;
  Profile: Profile;
  Staking: Staking;
};

describe('@integration KnowledgeAssets V9', () => {
  let accounts: SignerWithAddress[];
  let Hub: Hub;
  let KnowledgeAssets: KnowledgeAssets;
  let KnowledgeAssetsStorage: KnowledgeAssetsStorage;
  let EpochStorage: EpochStorage;
  let AskStorage: AskStorage;
  let Chronos: Chronos;
  let Token: Token;
  let ParametersStorage: ParametersStorage;
  let IdentityStorage: IdentityStorage;
  let Identity: Identity;
  let Profile: Profile;
  let Staking: Staking;

  async function deployV9Fixture(): Promise<V9Fixture> {
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
    ]);

    accounts = await hre.ethers.getSigners();
    const Hub = await hre.ethers.getContract<Hub>('Hub');

    const KnowledgeAssets = await hre.ethers.getContract<KnowledgeAssets>('KnowledgeAssets');
    const KnowledgeAssetsStorage = await hre.ethers.getContract<KnowledgeAssetsStorage>('KnowledgeAssetsStorage');
    const KnowledgeCollection = await hre.ethers.getContract<KnowledgeCollection>('KnowledgeCollection');
    const KnowledgeCollectionStorage = await hre.ethers.getContract<KnowledgeCollectionStorage>('KnowledgeCollectionStorage');
    const EpochStorage = await hre.ethers.getContract<EpochStorage>('EpochStorageV8');
    const AskStorage = await hre.ethers.getContract<AskStorage>('AskStorage');
    const Chronos = await hre.ethers.getContract<Chronos>('Chronos');
    const Token = await hre.ethers.getContract<Token>('Token');
    const ParametersStorage = await hre.ethers.getContract<ParametersStorage>('ParametersStorage');
    const IdentityStorage = await hre.ethers.getContract<IdentityStorage>('IdentityStorage');
    const Identity = await hre.ethers.getContract<Identity>('Identity');
    const Profile = await hre.ethers.getContract<Profile>('Profile');
    const Staking = await hre.ethers.getContract<Staking>('Staking');

    await Hub.setContractAddress('HubOwner', accounts[0].address);

    return {
      accounts,
      Hub,
      KnowledgeAssets,
      KnowledgeAssetsStorage,
      KnowledgeCollection,
      KnowledgeCollectionStorage,
      EpochStorage,
      AskStorage,
      Chronos,
      Token,
      ParametersStorage,
      IdentityStorage,
      Identity,
      Profile,
      Staking,
    };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({
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
      Staking,
    } = await loadFixture(deployV9Fixture));
  });

  // ========================================================================
  // Deployment & Registration
  // ========================================================================

  it('Should deploy V9 contracts and register them in Hub', async () => {
    const kaAddr = await Hub.getContractAddress('KnowledgeAssets');
    const kasAddr = await Hub.getAssetStorageAddress('KnowledgeAssetsStorage');

    expect(kaAddr).to.not.equal(ethers.ZeroAddress);
    expect(kasAddr).to.not.equal(ethers.ZeroAddress);

    expect(await KnowledgeAssets.name()).to.equal('KnowledgeAssets');
    expect(await KnowledgeAssetsStorage.name()).to.equal('KnowledgeAssetsStorage');
  });

  it('V8 KnowledgeCollection contracts still registered in Hub', async () => {
    const kcAddr = await Hub.getContractAddress('KnowledgeCollection');
    expect(kcAddr).to.not.equal(ethers.ZeroAddress);
  });

  // ========================================================================
  // UAL Range Reservation
  // ========================================================================

  it('Should reserve a UAL range for a publisher', async () => {
    const publishingNode = getDefaultPublishingNode(accounts);
    const { identityId } = await createProfile(Profile, publishingNode);

    // The operational account calls reserveUALRange
    const tx = await KnowledgeAssets.connect(publishingNode.operational)
      .reserveUALRange(identityId, 100);
    const receipt = await tx.wait();

    // Verify the range was reserved in storage
    const rangeCount = await KnowledgeAssetsStorage.getPublisherRangesCount(identityId);
    expect(rangeCount).to.equal(1);

    const [startId, endId] = await KnowledgeAssetsStorage.getPublisherRange(identityId, 0);
    expect(startId).to.equal(1);
    expect(endId).to.equal(100);

    // Verify nextId was updated
    const nextId = await KnowledgeAssetsStorage.publisherNextId(identityId);
    expect(nextId).to.equal(101);
  });

  it('Should reserve multiple ranges consecutively', async () => {
    const publishingNode = getDefaultPublishingNode(accounts);
    const { identityId } = await createProfile(Profile, publishingNode);

    await KnowledgeAssets.connect(publishingNode.operational).reserveUALRange(identityId, 50);
    await KnowledgeAssets.connect(publishingNode.operational).reserveUALRange(identityId, 30);

    const rangeCount = await KnowledgeAssetsStorage.getPublisherRangesCount(identityId);
    expect(rangeCount).to.equal(2);

    const [start1, end1] = await KnowledgeAssetsStorage.getPublisherRange(identityId, 0);
    expect(start1).to.equal(1);
    expect(end1).to.equal(50);

    const [start2, end2] = await KnowledgeAssetsStorage.getPublisherRange(identityId, 1);
    expect(start2).to.equal(51);
    expect(end2).to.equal(80);
  });

  it('Should reject reserveUALRange from non-operational key', async () => {
    const publishingNode = getDefaultPublishingNode(accounts);
    const { identityId } = await createProfile(Profile, publishingNode);

    // accounts[9] is not an operational key for the publisher
    await expect(
      KnowledgeAssets.connect(accounts[9]).reserveUALRange(identityId, 10)
    ).to.be.reverted;
  });

  // ========================================================================
  // Batch Minting (zero ask — proves the flow without TRAC)
  // ========================================================================

  it('Should batch-mint KAs with zero ask (no TRAC needed)', async () => {
    const publishingNode = getDefaultPublishingNode(accounts);
    const receivingNodes = getDefaultReceivingNodes(accounts);
    const kcCreator = getDefaultKCCreator(accounts);

    // Create profiles for all nodes
    const { identityId: pubId } = await createProfile(Profile, publishingNode);
    const receiverProfiles = await createProfiles(Profile, receivingNodes);
    const receiverIds = receiverProfiles.map((p) => p.identityId);

    // Reserve a UAL range
    await KnowledgeAssets.connect(publishingNode.operational).reserveUALRange(pubId, 10);

    // Prepare signatures
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('test-v9-merkleroot'));

    const publisherMsgHash = ethers.solidityPackedKeccak256(
      ['uint72', 'bytes32'],
      [pubId, merkleRoot],
    );
    const { r: pubR, vs: pubVS } = await signMessage(publishingNode.operational, publisherMsgHash);

    const receiverRs: string[] = [];
    const receiverVSs: string[] = [];
    for (const node of receivingNodes) {
      const { r, vs } = await signMessage(node.operational, merkleRoot);
      receiverRs.push(r);
      receiverVSs.push(vs);
    }

    // Batch mint: with 0 ask, tokenAmount=0 is valid
    const tx = await KnowledgeAssets.connect(kcCreator).batchMintKnowledgeAssets(
      pubId,
      merkleRoot,
      1,  // startKAId
      5,  // endKAId (5 KAs)
      1000, // publicByteSize
      2,    // epochs
      0,    // tokenAmount (0 because ask is 0)
      ethers.ZeroAddress, // paymaster
      pubR,
      pubVS,
      receiverIds,
      receiverRs,
      receiverVSs,
    );
    const receipt = await tx.wait();

    // Verify batch was created
    const batchId = await KnowledgeAssetsStorage.getLatestBatchId();
    expect(batchId).to.equal(1);

    const batch = await KnowledgeAssetsStorage.getBatch(1);
    expect(batch.publisherIdentityId).to.equal(pubId);
    expect(batch.publisherAddress).to.equal(kcCreator.address);
    expect(batch.merkleRoot).to.equal(merkleRoot);
    expect(batch.publicByteSize).to.equal(1000);
    expect(batch.knowledgeAssetsCount).to.equal(5);
    expect(batch.startKAId).to.equal(1);
    expect(batch.endKAId).to.equal(5);

    // Verify KA IDs are marked as used
    for (let id = 1; id <= 5; id++) {
      expect(await KnowledgeAssetsStorage.isKAIdUsed(pubId, id)).to.be.true;
      expect(await KnowledgeAssetsStorage.getBatchForKAId(pubId, id)).to.equal(1);
    }
    expect(await KnowledgeAssetsStorage.isKAIdUsed(pubId, 6)).to.be.false;

    // Verify totals
    expect(await KnowledgeAssetsStorage.getTotalKnowledgeAssets()).to.equal(5);
  });

  // ========================================================================
  // Batch Minting with TRAC Payment
  // ========================================================================

  it('Should batch-mint with TRAC payment when ask > 0', async () => {
    const publishingNode = getDefaultPublishingNode(accounts);
    const receivingNodes = getDefaultReceivingNodes(accounts);
    const kcCreator = getDefaultKCCreator(accounts);

    const { identityId: pubId } = await createProfile(Profile, publishingNode);
    const receiverProfiles = await createProfiles(Profile, receivingNodes);
    const receiverIds = receiverProfiles.map((p) => p.identityId);

    // Set a non-zero stakeWeightedAverageAsk by manipulating AskStorage directly
    // (normally done via Staking + Ask contracts, but direct setting is cleaner for testing)
    await AskStorage.setWeightedActiveAskSum(ethers.parseEther('1'));
    await AskStorage.setTotalActiveStake(1); // ask = 1 TRAC per kb per epoch

    // Calculate required token amount: ask * byteSize * epochs / 1024
    const byteSize = 2048; // 2 KB
    const epochs = 3;
    const ask = await AskStorage.getStakeWeightedAverageAsk();
    const tokenAmount = (ask * BigInt(byteSize) * BigInt(epochs)) / 1024n;

    // Fund the KC creator with TRAC
    await Token.mint(kcCreator.address, tokenAmount * 2n); // extra for safety

    // Approve the KnowledgeAssets contract to spend TRAC
    const kaAddr = await KnowledgeAssets.getAddress();
    await Token.connect(kcCreator).increaseAllowance(kaAddr, tokenAmount);

    // Reserve and sign
    await KnowledgeAssets.connect(publishingNode.operational).reserveUALRange(pubId, 10);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('test-trac-payment'));
    const pubMsgHash = ethers.solidityPackedKeccak256(
      ['uint72', 'bytes32'],
      [pubId, merkleRoot],
    );
    const { r: pubR, vs: pubVS } = await signMessage(publishingNode.operational, pubMsgHash);
    const receiverRs: string[] = [];
    const receiverVSs: string[] = [];
    for (const node of receivingNodes) {
      const { r, vs } = await signMessage(node.operational, merkleRoot);
      receiverRs.push(r);
      receiverVSs.push(vs);
    }

    // Record balance before
    const balanceBefore = await Token.balanceOf(kcCreator.address);

    // Batch mint
    await KnowledgeAssets.connect(kcCreator).batchMintKnowledgeAssets(
      pubId,
      merkleRoot,
      1, 3,      // 3 KAs
      byteSize,
      epochs,
      tokenAmount,
      ethers.ZeroAddress,
      pubR, pubVS,
      receiverIds,
      receiverRs,
      receiverVSs,
    );

    // Verify TRAC was transferred
    const balanceAfter = await Token.balanceOf(kcCreator.address);
    expect(balanceBefore - balanceAfter).to.equal(tokenAmount);

    // Verify batch
    const batch = await KnowledgeAssetsStorage.getBatch(1);
    expect(batch.tokenAmount).to.equal(tokenAmount);
    expect(batch.publicByteSize).to.equal(byteSize);
  });

  // ========================================================================
  // Cannot reuse KA IDs
  // ========================================================================

  it('Should reject batch-mint with already-used KA IDs', async () => {
    const publishingNode = getDefaultPublishingNode(accounts);
    const receivingNodes = getDefaultReceivingNodes(accounts);
    const kcCreator = getDefaultKCCreator(accounts);

    const { identityId: pubId } = await createProfile(Profile, publishingNode);
    const receiverProfiles = await createProfiles(Profile, receivingNodes);
    const receiverIds = receiverProfiles.map((p) => p.identityId);

    await KnowledgeAssets.connect(publishingNode.operational).reserveUALRange(pubId, 10);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('first-batch'));
    const pubMsgHash = ethers.solidityPackedKeccak256(['uint72', 'bytes32'], [pubId, merkleRoot]);
    const { r: pubR, vs: pubVS } = await signMessage(publishingNode.operational, pubMsgHash);
    const receiverRs: string[] = [];
    const receiverVSs: string[] = [];
    for (const node of receivingNodes) {
      const { r, vs } = await signMessage(node.operational, merkleRoot);
      receiverRs.push(r);
      receiverVSs.push(vs);
    }

    // First mint succeeds
    await KnowledgeAssets.connect(kcCreator).batchMintKnowledgeAssets(
      pubId, merkleRoot, 1, 3, 1000, 2, 0, ethers.ZeroAddress,
      pubR, pubVS, receiverIds, receiverRs, receiverVSs,
    );

    // Second mint with overlapping IDs should fail
    const merkleRoot2 = ethers.keccak256(ethers.toUtf8Bytes('second-batch'));
    const pubMsgHash2 = ethers.solidityPackedKeccak256(['uint72', 'bytes32'], [pubId, merkleRoot2]);
    const { r: pubR2, vs: pubVS2 } = await signMessage(publishingNode.operational, pubMsgHash2);
    const receiverRs2: string[] = [];
    const receiverVSs2: string[] = [];
    for (const node of receivingNodes) {
      const { r, vs } = await signMessage(node.operational, merkleRoot2);
      receiverRs2.push(r);
      receiverVSs2.push(vs);
    }

    await expect(
      KnowledgeAssets.connect(kcCreator).batchMintKnowledgeAssets(
        pubId, merkleRoot2, 1, 5, 1000, 2, 0, ethers.ZeroAddress,
        pubR2, pubVS2, receiverIds, receiverRs2, receiverVSs2,
      )
    ).to.be.reverted;
  });

  // ========================================================================
  // V8 + V9 Coexistence
  // ========================================================================

  it('V8 KnowledgeCollection and V9 KnowledgeAssets both work side by side', async () => {
    const publishingNode = getDefaultPublishingNode(accounts);
    const receivingNodes = getDefaultReceivingNodes(accounts);
    const kcCreator = getDefaultKCCreator(accounts);

    const { identityId: pubId } = await createProfile(Profile, publishingNode);
    const receiverProfiles = await createProfiles(Profile, receivingNodes);
    const receiverIds = receiverProfiles.map((p) => p.identityId);

    // --- V9 publish ---
    await KnowledgeAssets.connect(publishingNode.operational).reserveUALRange(pubId, 10);

    const v9MerkleRoot = ethers.keccak256(ethers.toUtf8Bytes('v9-data'));
    const v9PubHash = ethers.solidityPackedKeccak256(['uint72', 'bytes32'], [pubId, v9MerkleRoot]);
    const { r: v9PubR, vs: v9PubVS } = await signMessage(publishingNode.operational, v9PubHash);
    const v9RecRs: string[] = [];
    const v9RecVSs: string[] = [];
    for (const node of receivingNodes) {
      const { r, vs } = await signMessage(node.operational, v9MerkleRoot);
      v9RecRs.push(r);
      v9RecVSs.push(vs);
    }

    await KnowledgeAssets.connect(kcCreator).batchMintKnowledgeAssets(
      pubId, v9MerkleRoot, 1, 3, 1000, 2, 0, ethers.ZeroAddress,
      v9PubR, v9PubVS, receiverIds, v9RecRs, v9RecVSs,
    );

    // --- V8 publish (legacy flow) ---
    const v8MerkleRoot = ethers.keccak256(ethers.toUtf8Bytes('v8-legacy'));
    const v8PubHash = ethers.solidityPackedKeccak256(['uint72', 'bytes32'], [pubId, v8MerkleRoot]);
    const { r: v8PubR, vs: v8PubVS } = await signMessage(publishingNode.operational, v8PubHash);
    const v8RecRs: string[] = [];
    const v8RecVSs: string[] = [];
    for (const node of receivingNodes) {
      const { r, vs } = await signMessage(node.operational, v8MerkleRoot);
      v8RecRs.push(r);
      v8RecVSs.push(vs);
    }

    const KnowledgeCollection = await hre.ethers.getContract<KnowledgeCollection>('KnowledgeCollection');
    await KnowledgeCollection.connect(kcCreator).createKnowledgeCollection(
      'v8-legacy-op',
      v8MerkleRoot,
      5,
      1000,
      2,
      0,
      false,
      ethers.ZeroAddress,
      pubId,
      v8PubR,
      v8PubVS,
      receiverIds,
      v8RecRs,
      v8RecVSs,
    );

    // Both systems have data
    expect(await KnowledgeAssetsStorage.getLatestBatchId()).to.equal(1);

    const KnowledgeCollectionStorage = await hre.ethers.getContract<KnowledgeCollectionStorage>('KnowledgeCollectionStorage');
    expect(await KnowledgeCollectionStorage.getLatestKnowledgeCollectionId()).to.equal(1);

    // V9 batch and V8 collection are independent
    const v9Batch = await KnowledgeAssetsStorage.getBatch(1);
    expect(v9Batch.merkleRoot).to.equal(v9MerkleRoot);

    const v8Root = await KnowledgeCollectionStorage.getLatestMerkleRoot(1);
    expect(v8Root).to.equal(v8MerkleRoot);
  });
});
