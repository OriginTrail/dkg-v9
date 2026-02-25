import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

import { Chronos } from '../../typechain';

describe('@unit Chronos', () => {
  let accounts: SignerWithAddress[];
  let Chronos: Chronos;

  async function deployChronosFixture() {
    const currentTime = await time.latest();
    const startTime = currentTime + 3600; // Start 1 hour from now
    const epochLength = 3600; // 1 hour epochs

    const ChronosFactory = await hre.ethers.getContractFactory('Chronos');
    Chronos = await ChronosFactory.deploy(startTime, epochLength);

    accounts = await hre.ethers.getSigners();
    return { accounts, Chronos, startTime, epochLength };
  }

  beforeEach(async () => {
    ({ accounts, Chronos } = await loadFixture(deployChronosFixture));
  });

  describe('Constructor', () => {
    it('Should revert with invalid start time', async () => {
      const ChronosFactory = await hre.ethers.getContractFactory('Chronos');
      await expect(
        ChronosFactory.deploy(0, 3600),
      ).to.be.revertedWithCustomError(ChronosFactory, 'InvalidStartTime');
    });

    it('Should revert with invalid epoch length', async () => {
      const currentTime = await time.latest();
      const ChronosFactory = await hre.ethers.getContractFactory('Chronos');
      await expect(
        ChronosFactory.deploy(currentTime + 3600, 0),
      ).to.be.revertedWithCustomError(ChronosFactory, 'InvalidEpochLength');
    });
  });

  describe('Basic getters', () => {
    it('Should return correct start time', async () => {
      const startTime = await Chronos.START_TIME();
      expect(await Chronos.startTime()).to.equal(startTime);
    });

    it('Should return correct epoch length', async () => {
      const epochLength = await Chronos.EPOCH_LENGTH();
      expect(await Chronos.epochLength()).to.equal(epochLength);
    });
  });

  describe('getCurrentEpoch', () => {
    it('Should return 1 before start time', async () => {
      expect(await Chronos.getCurrentEpoch()).to.equal(1);
    });

    it('Should return correct epoch after start time', async () => {
      const startTime = await Chronos.START_TIME();
      await time.increaseTo('0x' + startTime.toString(16));
      await time.increase(7200); // 2 hours after start
      expect(await Chronos.getCurrentEpoch()).to.equal(3); // Should be in 3rd epoch
    });
  });

  describe('epochAtTimestamp', () => {
    it('Should return 1 for timestamp before start time', async () => {
      const startTime = await Chronos.START_TIME();
      expect(await Chronos.epochAtTimestamp(startTime - 1n)).to.equal(1);
    });

    it('Should return correct epoch for timestamp after start time', async () => {
      const startTime = await Chronos.START_TIME();
      const timestamp = startTime + 7200n; // 2 hours after start
      expect(await Chronos.epochAtTimestamp(timestamp)).to.equal(3);
    });
  });

  describe('timeUntilNextEpoch', () => {
    it('Should return time until first epoch before start', async () => {
      const startTime = await Chronos.START_TIME();
      const currentTime = await time.latest();
      const expected = startTime + 3600n - BigInt(currentTime);
      expect(await Chronos.timeUntilNextEpoch()).to.be.closeTo(expected, 5);
    });

    it('Should return correct time within an epoch', async () => {
      const startTime = await Chronos.START_TIME();
      await time.increaseTo('0x' + startTime.toString(16));
      await time.increase(1800); // Half epoch passed
      expect(await Chronos.timeUntilNextEpoch()).to.be.closeTo(1800n, 5);
    });
  });

  /* eslint-disable @typescript-eslint/no-unused-expressions */
  describe('hasEpochElapsed', () => {
    it('Should return false for future epochs', async () => {
      expect(await Chronos.hasEpochElapsed(5)).to.be.false;
    });

    it('Should return true for past epochs', async () => {
      const startTime = await Chronos.START_TIME();
      await time.increaseTo('0x' + startTime.toString(16));
      await time.increase(7200); // 2 hours after start
      expect(await Chronos.hasEpochElapsed(2)).to.be.true;
    });
  });

  describe('timestampForEpoch', () => {
    it('Should return 0 for epoch 0', async () => {
      expect(await Chronos.timestampForEpoch(0)).to.equal(0);
    });

    it('Should return correct timestamp for future epoch', async () => {
      const startTime = await Chronos.START_TIME();
      const epochLength = await Chronos.EPOCH_LENGTH();
      expect(await Chronos.timestampForEpoch(3)).to.equal(
        startTime + epochLength * 2n,
      );
    });
  });

  describe('elapsedTimeInCurrentEpoch', () => {
    it('Should return 0 before start time', async () => {
      expect(await Chronos.elapsedTimeInCurrentEpoch()).to.equal(0);
    });

    it('Should return correct elapsed time within epoch', async () => {
      const startTime = await Chronos.START_TIME();
      await time.increaseTo('0x' + startTime.toString(16));
      await time.increase(1800); // Half epoch passed
      expect(await Chronos.elapsedTimeInCurrentEpoch()).to.be.closeTo(1800n, 5);
    });
  });

  describe('totalElapsedTime', () => {
    it('Should return 0 before start time', async () => {
      expect(await Chronos.totalElapsedTime()).to.equal(0);
    });

    it('Should return correct total elapsed time', async () => {
      const startTime = await Chronos.START_TIME();
      await time.increaseTo('0x' + startTime.toString(16));
      await time.increase(7200); // 2 hours after start
      expect(await Chronos.totalElapsedTime()).to.be.closeTo(7200n, 5);
    });
  });

  describe('isChronosActive', () => {
    it('Should return false before start time', async () => {
      expect(await Chronos.isChronosActive()).to.be.false;
    });

    it('Should return true after start time', async () => {
      const startTime = await Chronos.START_TIME();
      await time.increaseTo('0x' + startTime.toString(16));
      expect(await Chronos.isChronosActive()).to.be.true;
    });
  });
});
