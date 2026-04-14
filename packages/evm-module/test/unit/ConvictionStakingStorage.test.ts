import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

import { ConvictionStakingStorage, Chronos } from '../../typechain';

type Fixture = {
  accounts: SignerWithAddress[];
  ConvictionStakingStorage: ConvictionStakingStorage;
  Chronos: Chronos;
};

const ALICE_ID = 100n;
const BOB_ID = 200n;
const OTHER_ID = 999n;

describe('@unit ConvictionStakingStorage', () => {
  let accounts: SignerWithAddress[];
  let ConvictionStakingStorage: ConvictionStakingStorage;
  let Chronos: Chronos;

  async function deployFixture(): Promise<Fixture> {
    await hre.deployments.fixture(['ConvictionStakingStorage']);
    ConvictionStakingStorage = await hre.ethers.getContract<ConvictionStakingStorage>(
      'ConvictionStakingStorage',
    );
    Chronos = await hre.ethers.getContract<Chronos>('Chronos');
    accounts = await hre.ethers.getSigners();
    return { accounts, ConvictionStakingStorage, Chronos };
  }

  async function advanceEpochs(n: number) {
    const epochLength = await Chronos.epochLength();
    await time.increase(Number(epochLength) * n);
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({ accounts, ConvictionStakingStorage, Chronos } = await loadFixture(deployFixture));
  });

  // ------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------

  it('Should have correct name and version', async () => {
    expect(await ConvictionStakingStorage.name()).to.equal('ConvictionStakingStorage');
    expect(await ConvictionStakingStorage.version()).to.equal('1.0.0');
  });

  // ------------------------------------------------------------
  // Task A — createPosition + single-position global finalize
  // ------------------------------------------------------------

  describe('createPosition — single position', () => {
    it('Stores position fields with zero-lock (permanent 1x)', async () => {
      const currentEpoch = await Chronos.getCurrentEpoch();
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 0, 1);

      const pos = await ConvictionStakingStorage.getPosition(1);
      expect(pos.raw).to.equal(1000);
      expect(pos.lockEpochs).to.equal(0);
      expect(pos.expiryEpoch).to.equal(0);
      expect(pos.multiplier).to.equal(1);
      expect(pos.identityId).to.equal(ALICE_ID);
      expect(pos.lastClaimedEpoch).to.equal(currentEpoch - 1n);
    });

    it('Global effective stake equals raw forever when lock=0 mult=1', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 0, 1);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(1)).to.equal(1000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(5)).to.equal(1000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(1000)).to.equal(1000);
    });

    it('Locked boosted position reverts to raw after expiry', async () => {
      // createdAt=1, lock=11, mult=6 → expiry=12, effective 6000 in [1,11], 1000 after
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      const pos = await ConvictionStakingStorage.getPosition(1);
      expect(pos.expiryEpoch).to.equal(12);

      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(1)).to.equal(6000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(11)).to.equal(6000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(12)).to.equal(1000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(50)).to.equal(1000);
    });

    it('Reverts on invalid inputs', async () => {
      await expect(
        ConvictionStakingStorage.createPosition(1, ALICE_ID, 0, 11, 6),
      ).to.be.revertedWith('Zero raw');

      await expect(
        ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 0),
      ).to.be.revertedWith('Bad multiplier');

      await expect(
        ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 0, 6),
      ).to.be.revertedWith('Lock0 must be 1x');

      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await expect(
        ConvictionStakingStorage.createPosition(1, ALICE_ID, 500, 5, 2),
      ).to.be.revertedWith('Position exists');
    });
  });

  // ------------------------------------------------------------
  // Task B — concurrent expiry denominator (Alice 6x + Bob 1x)
  // ------------------------------------------------------------

  describe('concurrent expiry denominator', () => {
    it('Alice 1000x6x expiring e12 + Bob 1000x1x perm → 7000 [1..11], 2000 [12..∞)', async () => {
      // Both created at epoch 1
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6); // expiry 12
      await ConvictionStakingStorage.createPosition(2, BOB_ID, 1000, 0, 1); // perm

      for (let e = 1; e <= 11; e++) {
        expect(
          await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(e),
          `epoch ${e}`,
        ).to.equal(7000);
      }
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(12)).to.equal(2000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(20)).to.equal(2000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(1000)).to.equal(2000);
    });
  });

  // ------------------------------------------------------------
  // Task C — per-node diff + multi-NFT-per-node
  // ------------------------------------------------------------

  describe('per-node diff + multi-NFT-per-node', () => {
    it('Two NFTs under same identityId track independent expiries', async () => {
      // nft1: raw=500, lock=11, mult=6 → effective 3000 in [1..11], 500 in [12..∞)
      // nft2: raw=200, lock=5, mult=3 → effective  600 in [1..5],  200 in  [6..∞)
      // per-node total: [1..5]=3600, [6..11]=3200, [12..∞)=700
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 500, 11, 6);
      await ConvictionStakingStorage.createPosition(2, ALICE_ID, 200, 5, 3);

      for (let e = 1; e <= 5; e++) {
        expect(
          await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, e),
          `e${e}`,
        ).to.equal(3600);
      }
      for (let e = 6; e <= 11; e++) {
        expect(
          await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, e),
          `e${e}`,
        ).to.equal(3200);
      }
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, 12)).to.equal(700);
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, 500)).to.equal(700);
    });

    it('Second node is unaffected by first node writes', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 500, 11, 6);
      await ConvictionStakingStorage.createPosition(2, ALICE_ID, 200, 5, 3);

      for (let e = 1; e <= 20; e++) {
        expect(
          await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(BOB_ID, e),
          `bob e${e}`,
        ).to.equal(0);
      }
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(OTHER_ID, 1)).to.equal(0);
    });

    it('Per-node mirrors global when there is a single node', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await ConvictionStakingStorage.createPosition(2, ALICE_ID, 1000, 0, 1);

      for (const e of [1, 5, 11, 12, 20]) {
        expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, e)).to.equal(
          await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(e),
        );
      }
    });
  });

  // ------------------------------------------------------------
  // Task D — mutators
  // ------------------------------------------------------------

  describe('updateOnRelock', () => {
    it('Re-commits after expiry: correct diff layering and new expiry', async () => {
      // Create at e=1: raw=1000, lock=5, mult=2 → diff[1]+=2000, diff[6]-=1000
      // Effective: [1..5]=2000, [6..∞)=1000
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 5, 2);

      // Advance to epoch 6 (past expiry)
      await advanceEpochs(5);
      expect(await Chronos.getCurrentEpoch()).to.equal(6);

      // Relock: lock=10, mult=3 → new expiry = 16, adds raw*(3-1)=2000 boost at e=6, -2000 at e=16
      await ConvictionStakingStorage.updateOnRelock(1, 10, 3);
      const pos = await ConvictionStakingStorage.getPosition(1);
      expect(pos.lockEpochs).to.equal(10);
      expect(pos.multiplier).to.equal(3);
      expect(pos.expiryEpoch).to.equal(16);

      // Effective: [1..5]=2000, [6..15]=3000 (raw*3), [16..∞)=1000 (raw)
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(5)).to.equal(2000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(6)).to.equal(3000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(15)).to.equal(3000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(16)).to.equal(1000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(100)).to.equal(1000);
    });

    it('Reverts if called before expiry', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 5, 2);
      await expect(
        ConvictionStakingStorage.updateOnRelock(1, 10, 3),
      ).to.be.revertedWith('Not expired');
    });

    it('Reverts on non-existent position', async () => {
      await expect(
        ConvictionStakingStorage.updateOnRelock(1, 10, 3),
      ).to.be.revertedWith('No position');
    });
  });

  describe('updateOnRedelegate', () => {
    it('Moves per-node diff while leaving global totals unchanged', async () => {
      // Alice: raw=1000, lock=11, mult=6 under ALICE_ID
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);

      // Redelegate to BOB_ID at epoch 1
      await ConvictionStakingStorage.updateOnRedelegate(1, BOB_ID);
      expect((await ConvictionStakingStorage.getPosition(1)).identityId).to.equal(BOB_ID);

      // Global: unchanged — 6000 in [1..11], 1000 after
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(1)).to.equal(6000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(11)).to.equal(6000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(12)).to.equal(1000);

      // Per-node: ALICE is empty, BOB carries the whole position
      for (const e of [1, 5, 11, 12, 20]) {
        expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, e)).to.equal(0);
      }
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(BOB_ID, 1)).to.equal(6000);
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(BOB_ID, 11)).to.equal(6000);
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(BOB_ID, 12)).to.equal(1000);
    });

    it('Redelegate of a post-expiry position moves only the raw tail', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 4, 2);
      // advance past expiry (epoch 5)
      await advanceEpochs(4);
      expect(await Chronos.getCurrentEpoch()).to.equal(5);

      await ConvictionStakingStorage.updateOnRedelegate(1, BOB_ID);

      // ALICE contribution after epoch 5 = 0, BOB carries 1000 forward
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, 5)).to.equal(0);
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, 50)).to.equal(0);
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(BOB_ID, 5)).to.equal(1000);
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(BOB_ID, 50)).to.equal(1000);

      // Pre-redelegate history on ALICE is untouched: ALICE had the boost in [1..4]
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, 1)).to.equal(2000);
      expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, 4)).to.equal(2000);
    });

    it('Reverts when redelegating to same node', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await expect(
        ConvictionStakingStorage.updateOnRedelegate(1, ALICE_ID),
      ).to.be.revertedWith('Same node');
    });
  });

  describe('deletePosition', () => {
    it('Wipes position + cancels future diff contributions', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await ConvictionStakingStorage.deletePosition(1);

      const pos = await ConvictionStakingStorage.getPosition(1);
      expect(pos.raw).to.equal(0);
      expect(pos.identityId).to.equal(0);

      for (const e of [1, 5, 11, 12, 50]) {
        expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(e)).to.equal(0);
        expect(await ConvictionStakingStorage.getNodeEffectiveStakeAtEpoch(ALICE_ID, e)).to.equal(0);
      }
    });

    it('Delete after expiry removes remaining raw tail only', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 4, 2);
      await advanceEpochs(4); // e=5
      await ConvictionStakingStorage.deletePosition(1);

      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(5)).to.equal(0);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(100)).to.equal(0);
      // Historical windows (pre-delete) stay intact: boost was 2000 in [1..4]
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(1)).to.equal(2000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(4)).to.equal(2000);
    });

    it('Reverts on missing position', async () => {
      await expect(ConvictionStakingStorage.deletePosition(42)).to.be.revertedWith('No position');
    });
  });

  describe('setLastClaimedEpoch', () => {
    it('Updates lastClaimedEpoch', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await ConvictionStakingStorage.setLastClaimedEpoch(1, 42);
      expect((await ConvictionStakingStorage.getPosition(1)).lastClaimedEpoch).to.equal(42);
    });

    it('Reverts on missing position', async () => {
      await expect(
        ConvictionStakingStorage.setLastClaimedEpoch(1, 1),
      ).to.be.revertedWith('No position');
    });
  });

  // ------------------------------------------------------------
  // Task E — finalize edges
  // ------------------------------------------------------------

  describe('finalize edges', () => {
    it('Idempotent: re-finalize is a no-op', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await advanceEpochs(5); // e=6

      // First mutator call finalizes [1..5]
      await ConvictionStakingStorage.setLastClaimedEpoch(1, 1); // no-op for finalize, but createPosition finalizes
      await ConvictionStakingStorage.createPosition(2, BOB_ID, 500, 0, 1);
      const after1 = await ConvictionStakingStorage.getLastFinalizedEpoch();
      expect(after1).to.equal(5n);
      const snap1 = await ConvictionStakingStorage.totalEffectiveStakeAtEpoch(5);

      // Second mutator call at same epoch: finalize up to e=5 again — no-op
      await ConvictionStakingStorage.createPosition(3, OTHER_ID, 100, 0, 1);
      const after2 = await ConvictionStakingStorage.getLastFinalizedEpoch();
      expect(after2).to.equal(5n);
      expect(await ConvictionStakingStorage.totalEffectiveStakeAtEpoch(5)).to.equal(snap1);
    });

    it('Gap finalize: fills N dormant epochs in one call', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      // diff[1]=+6000, diff[12]=-5000. Advance to epoch 20.
      await advanceEpochs(19);
      expect(await Chronos.getCurrentEpoch()).to.equal(20);

      // Single mutator call finalizes epochs [1..19]
      await ConvictionStakingStorage.createPosition(2, BOB_ID, 100, 0, 1);

      expect(await ConvictionStakingStorage.getLastFinalizedEpoch()).to.equal(19n);
      // Hand-computed snapshots
      for (let e = 1; e <= 11; e++) {
        expect(await ConvictionStakingStorage.totalEffectiveStakeAtEpoch(e), `e${e}`).to.equal(6000);
      }
      for (let e = 12; e <= 19; e++) {
        expect(await ConvictionStakingStorage.totalEffectiveStakeAtEpoch(e), `e${e}`).to.equal(1000);
      }
    });

    it('Lazy-finalize consistency: createPosition after gap sees correct denominator', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await advanceEpochs(2); // e=3

      // Create second position at epoch 3; global at e=3 should already account for Alice's 6000
      await ConvictionStakingStorage.createPosition(2, BOB_ID, 500, 0, 1);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(3)).to.equal(6500);
      // And the historical windows are consistent
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(1)).to.equal(6000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(2)).to.equal(6000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(12)).to.equal(1500);
    });

    it('Integer safety: expiry + delete + new create cannot underflow', async () => {
      await ConvictionStakingStorage.createPosition(1, ALICE_ID, 1000, 11, 6);
      await advanceEpochs(11); // e=12 — past expiry
      // Delete the now raw-only position; no underflow on expiry cancel
      await ConvictionStakingStorage.deletePosition(1);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(12)).to.equal(0);
      // Create a fresh one and verify denominator is sane
      await ConvictionStakingStorage.createPosition(2, BOB_ID, 500, 4, 2);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(12)).to.equal(1000);
      expect(await ConvictionStakingStorage.getTotalEffectiveStakeAtEpoch(16)).to.equal(500);
    });
  });
});
