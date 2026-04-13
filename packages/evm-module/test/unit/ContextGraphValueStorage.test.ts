import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

import { Chronos, ContextGraphValueStorage, Hub } from '../../typechain';

type Fixture = {
  accounts: SignerWithAddress[];
  CGV: ContextGraphValueStorage;
  Chronos: Chronos;
  Hub: Hub;
};

describe('@unit ContextGraphValueStorage', () => {
  let accounts: SignerWithAddress[];
  let CGV: ContextGraphValueStorage;
  let ChronosCtr: Chronos;
  let HubCtr: Hub;

  async function deployFixture(): Promise<Fixture> {
    await hre.deployments.fixture(['ContextGraphValueStorage']);
    const CGVLocal = await hre.ethers.getContract<ContextGraphValueStorage>(
      'ContextGraphValueStorage',
    );
    const ChronosLocal = await hre.ethers.getContract<Chronos>('Chronos');
    const HubLocal = await hre.ethers.getContract<Hub>('Hub');
    const accountsLocal = await hre.ethers.getSigners();
    return {
      accounts: accountsLocal,
      CGV: CGVLocal,
      Chronos: ChronosLocal,
      Hub: HubLocal,
    };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({
      accounts,
      CGV,
      Chronos: ChronosCtr,
      Hub: HubCtr,
    } = await loadFixture(deployFixture));
  });

  it('Should have correct name and version', async () => {
    expect(await CGV.name()).to.equal('ContextGraphValueStorage');
    expect(await CGV.version()).to.equal('1.0.0');
  });

  it('Single-epoch publish: value lives in start epoch, zero after', async () => {
    const cgId = 1n;
    const currentEpoch = await ChronosCtr.getCurrentEpoch();

    await CGV.addCGValueForEpochRange(cgId, currentEpoch, 1, 1000);

    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch)).to.equal(1000);
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 1n)).to.equal(0);

    expect(await CGV.getTotalValueAtEpoch(currentEpoch)).to.equal(1000);
    expect(await CGV.getTotalValueAtEpoch(currentEpoch + 1n)).to.equal(0);
  });

  it('Multi-epoch publish: V/L per epoch for L epochs, zero thereafter', async () => {
    const cgId = 2n;
    const currentEpoch = await ChronosCtr.getCurrentEpoch();

    await CGV.addCGValueForEpochRange(cgId, currentEpoch, 10, 1000);

    for (let i = 0n; i < 10n; i++) {
      expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + i)).to.equal(100);
      expect(await CGV.getTotalValueAtEpoch(currentEpoch + i)).to.equal(100);
    }
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 10n)).to.equal(0);
    expect(await CGV.getTotalValueAtEpoch(currentEpoch + 10n)).to.equal(0);
  });

  it('Two concurrent CGs: per-CG totals correct, global total equals sum', async () => {
    const cgA = 10n;
    const cgB = 11n;
    const currentEpoch = await ChronosCtr.getCurrentEpoch();

    // CG A: 1000 over 5 epochs => 200/epoch
    await CGV.addCGValueForEpochRange(cgA, currentEpoch, 5, 1000);
    // CG B: 600 over 3 epochs => 200/epoch
    await CGV.addCGValueForEpochRange(cgB, currentEpoch, 3, 600);

    for (let i = 0n; i < 3n; i++) {
      expect(await CGV.getCGValueAtEpoch(cgA, currentEpoch + i)).to.equal(200);
      expect(await CGV.getCGValueAtEpoch(cgB, currentEpoch + i)).to.equal(200);
      expect(await CGV.getTotalValueAtEpoch(currentEpoch + i)).to.equal(400);
    }
    // Epochs 3-4: only CG A active
    for (let i = 3n; i < 5n; i++) {
      expect(await CGV.getCGValueAtEpoch(cgA, currentEpoch + i)).to.equal(200);
      expect(await CGV.getCGValueAtEpoch(cgB, currentEpoch + i)).to.equal(0);
      expect(await CGV.getTotalValueAtEpoch(currentEpoch + i)).to.equal(200);
    }
    // Epoch 5: both expired
    expect(await CGV.getCGValueAtEpoch(cgA, currentEpoch + 5n)).to.equal(0);
    expect(await CGV.getTotalValueAtEpoch(currentEpoch + 5n)).to.equal(0);
  });

  it('Overlapping publishes on same CG sum per epoch', async () => {
    const cgId = 20n;
    const currentEpoch = await ChronosCtr.getCurrentEpoch();

    // 4000 over 4 epochs starting at currentEpoch => 1000/epoch, range
    // [currentEpoch, currentEpoch+3]
    await CGV.addCGValueForEpochRange(cgId, currentEpoch, 4, 4000);
    // 900 over 3 epochs starting at currentEpoch+2 => 300/epoch, range
    // [currentEpoch+2, currentEpoch+4]
    await CGV.addCGValueForEpochRange(cgId, currentEpoch + 2n, 3, 900);

    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch)).to.equal(1000);
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 1n)).to.equal(1000);
    // Overlap region
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 2n)).to.equal(1300);
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 3n)).to.equal(1300);
    // Only second publish active
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 4n)).to.equal(300);
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 5n)).to.equal(0);
  });

  it('Finalize is idempotent: second call in same epoch does not double-apply', async () => {
    const cgId = 30n;
    const currentEpoch = await ChronosCtr.getCurrentEpoch();

    await CGV.addCGValueForEpochRange(cgId, currentEpoch, 3, 900);

    const first = await CGV.getCGValueAtEpoch(cgId, currentEpoch);
    const firstTotal = await CGV.getTotalValueAtEpoch(currentEpoch);
    const firstFinalized = await CGV.cgLastFinalizedEpoch(cgId);

    // Second add in same epoch, same shape — finalization runs again but is a
    // no-op for the already-finalized range.
    await CGV.addCGValueForEpochRange(cgId, currentEpoch, 3, 900);

    // Per-epoch now sums two 300/epoch writes = 600
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch)).to.equal(600);
    // First read was a simulation (no finalization occurred yet since we're in
    // currentEpoch); the invariant we care about: lastFinalizedEpoch did not
    // advance past the previous epoch.
    expect(await CGV.cgLastFinalizedEpoch(cgId)).to.equal(firstFinalized);

    expect(first).to.equal(300);
    expect(firstTotal).to.equal(300);
  });

  it('Finalize across a gap: dormant for N epochs then single call finalizes all intermediate epochs', async () => {
    const cgId = 40n;
    const startEpoch = await ChronosCtr.getCurrentEpoch();

    // Publish spanning 10 epochs.
    await CGV.addCGValueForEpochRange(cgId, startEpoch, 10, 1000);

    const epochLength = await ChronosCtr.epochLength();
    // Advance time by 5 epochs without touching CGV — finalization becomes stale.
    await time.increase(Number(epochLength) * 5 + 1);

    const nowEpoch = await ChronosCtr.getCurrentEpoch();
    expect(nowEpoch).to.be.gte(startEpoch + 5n);

    // Trigger finalization by publishing a new value to a DIFFERENT cgId —
    // exercises the global finalize path but leaves cgId dormant.
    await CGV.addCGValueForEpochRange(cgId + 1n, nowEpoch, 1, 1);

    // cgId has NOT been finalized yet (different cgId triggered only global + cgId+1).
    // The simulation path must still return correct values for cgId across the gap.
    for (let i = 0n; i < 10n; i++) {
      expect(await CGV.getCGValueAtEpoch(cgId, startEpoch + i)).to.equal(100);
    }
    expect(await CGV.getCGValueAtEpoch(cgId, startEpoch + 10n)).to.equal(0);

    // Now call into cgId directly to force its finalization up to currentEpoch-1.
    await CGV.addCGValueForEpochRange(cgId, nowEpoch + 100n, 1, 1);
    const lastFinalized = await CGV.cgLastFinalizedEpoch(cgId);
    expect(lastFinalized).to.equal(nowEpoch - 1n);

    // Finalized values for the gap epochs must match the simulated values.
    for (let i = 0n; i < 10n; i++) {
      if (startEpoch + i <= lastFinalized) {
        expect(await CGV.cgValueCumulative(cgId, startEpoch + i)).to.equal(100);
      }
    }
  });

  it('Simulation returns correct value for non-finalized future epoch', async () => {
    const cgId = 50n;
    const currentEpoch = await ChronosCtr.getCurrentEpoch();

    await CGV.addCGValueForEpochRange(cgId, currentEpoch + 5n, 4, 800);

    // lastFinalized still <= currentEpoch - 1; reading currentEpoch+6 must
    // traverse the diff map via _simulateCGValueFinalization.
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 5n)).to.equal(200);
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 6n)).to.equal(200);
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 8n)).to.equal(200);
    expect(await CGV.getCGValueAtEpoch(cgId, currentEpoch + 9n)).to.equal(0);
    // Global same semantics
    expect(await CGV.getTotalValueAtEpoch(currentEpoch + 5n)).to.equal(200);
    expect(await CGV.getTotalValueAtEpoch(currentEpoch + 9n)).to.equal(0);
  });

  it('getCurrentCGValue / getCurrentTotalValue mirror getCGValueAtEpoch at current epoch', async () => {
    const cgId = 60n;
    const currentEpoch = await ChronosCtr.getCurrentEpoch();
    await CGV.addCGValueForEpochRange(cgId, currentEpoch, 2, 500);

    // 500/2 = 250 per epoch
    expect(await CGV.getCurrentCGValue(cgId)).to.equal(250);
    expect(await CGV.getCurrentTotalValue()).to.equal(250);
  });

  it('onlyContracts: non-Hub-registered EOA cannot call addCGValueForEpochRange', async () => {
    const currentEpoch = await ChronosCtr.getCurrentEpoch();
    // accounts[1] is not the Hub owner nor registered as a Hub contract.
    const stranger = accounts[1];
    await expect(
      CGV.connect(stranger).addCGValueForEpochRange(
        1n,
        currentEpoch,
        1,
        1000,
      ),
    ).to.be.reverted;
  });

  it('Reverts on zero lifetime and zero value', async () => {
    const currentEpoch = await ChronosCtr.getCurrentEpoch();
    await expect(
      CGV.addCGValueForEpochRange(1n, currentEpoch, 0, 1000),
    ).to.be.revertedWithCustomError(CGV, 'ZeroLifetime');
    await expect(
      CGV.addCGValueForEpochRange(1n, currentEpoch, 1, 0),
    ).to.be.revertedWithCustomError(CGV, 'ZeroValue');
  });

  it('Chronos and Hub are wired via initialize', async () => {
    expect(await CGV.chronos()).to.equal(await ChronosCtr.getAddress());
    expect(await CGV.hub()).to.equal(await HubCtr.getAddress());
  });
});
