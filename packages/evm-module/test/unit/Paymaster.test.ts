import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { parseEther } from 'ethers';
import hre from 'hardhat';

import { Hub, Paymaster, Token } from '../../typechain';

describe('@unit Paymaster', () => {
  let accounts: SignerWithAddress[];
  let Hub: Hub;
  let Token: Token;
  let Paymaster: Paymaster;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let knowledgeCollectionAddress: string;

  async function deployPaymasterFixture() {
    await hre.deployments.fixture(['Hub', 'Token']);

    accounts = await hre.ethers.getSigners();
    [owner, user] = accounts;

    Hub = await hre.ethers.getContract<Hub>('Hub');
    Token = await hre.ethers.getContract<Token>('Token');

    // Deploy Paymaster
    const PaymasterFactory = await hre.ethers.getContractFactory('Paymaster');
    Paymaster = await PaymasterFactory.deploy(Hub.getAddress());

    // Set mock KnowledgeCollection address in Hub
    knowledgeCollectionAddress = accounts[3].address;
    await Hub.setContractAddress(
      'KnowledgeCollection',
      knowledgeCollectionAddress,
    );

    // Reset user's balance to zero first
    const initialBalance = await Token.balanceOf(user.address);
    if (initialBalance > 0) {
      const BURN_ADDRESS = accounts[66].address;
      await Token.connect(user).transfer(BURN_ADDRESS, initialBalance);
    }

    // Mint some tokens to user for testing
    await Token.mint(user.address, parseEther('100'));

    return { accounts, Hub, Token, Paymaster, owner, user };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({ accounts, Hub, Token, Paymaster, owner, user } = await loadFixture(
      deployPaymasterFixture,
    ));
  });

  describe('Constructor', () => {
    it('Should set correct hub address', async () => {
      expect(await Paymaster.hub()).to.equal(await Hub.getAddress());
    });

    it('Should set correct token contract', async () => {
      expect(await Paymaster.tokenContract()).to.equal(
        await Token.getAddress(),
      );
    });

    it('Should set correct owner', async () => {
      expect(await Paymaster.owner()).to.equal(owner.address);
    });
  });

  /* eslint-disable @typescript-eslint/no-unused-expressions */
  describe('Access Control', () => {
    it('Should allow owner to add allowed address', async () => {
      await Paymaster.addAllowedAddress(user.address);
      expect(await Paymaster.allowedAddresses(user.address)).to.be.true;
    });

    it('Should not allow non-owner to add allowed address', async () => {
      await expect(
        Paymaster.connect(user).addAllowedAddress(user.address),
      ).to.be.revertedWithCustomError(Paymaster, 'OwnableUnauthorizedAccount');
    });

    it('Should allow owner to remove allowed address', async () => {
      await Paymaster.addAllowedAddress(user.address);
      await Paymaster.removeAllowedAddress(user.address);
      expect(await Paymaster.allowedAddresses(user.address)).to.be.false;
    });
  });

  describe('Fund Paymaster', () => {
    const fundAmount = parseEther('100');

    beforeEach(async () => {
      // Approve tokens first
      await Token.connect(user).approve(Paymaster.getAddress(), fundAmount);
    });

    it('Should allow funding with tokens', async () => {
      await expect(Paymaster.connect(user).fundPaymaster(fundAmount))
        .to.emit(Token, 'Transfer')
        .withArgs(user.address, await Paymaster.getAddress(), fundAmount);
    });

    it('Should revert with zero amount', async () => {
      await expect(
        Paymaster.connect(user).fundPaymaster(0),
      ).to.be.revertedWithCustomError(Paymaster, 'ZeroTokenAmount');
    });

    it('Should revert with insufficient allowance', async () => {
      await Token.connect(user).approve(Paymaster.getAddress(), 0);
      await expect(
        Paymaster.connect(user).fundPaymaster(fundAmount),
      ).to.be.revertedWithCustomError(Paymaster, 'TooLowAllowance');
    });

    it('Should revert with insufficient balance', async () => {
      const tooMuch = parseEther('200');
      await Token.connect(user).approve(Paymaster.getAddress(), tooMuch);
      await expect(
        Paymaster.connect(user).fundPaymaster(tooMuch),
      ).to.be.revertedWithCustomError(Paymaster, 'TooLowBalance');
    });
  });

  describe('Withdraw', () => {
    const withdrawAmount = parseEther('50');

    beforeEach(async () => {
      // Fund the paymaster first
      await Token.connect(user).approve(
        Paymaster.getAddress(),
        parseEther('100'),
      );
      await Paymaster.connect(user).fundPaymaster(parseEther('100'));
    });

    it('Should allow owner to withdraw tokens', async () => {
      await expect(Paymaster.withdraw(owner.address, withdrawAmount))
        .to.emit(Token, 'Transfer')
        .withArgs(await Paymaster.getAddress(), owner.address, withdrawAmount);
    });

    it('Should revert when non-owner tries to withdraw', async () => {
      await expect(
        Paymaster.connect(user).withdraw(user.address, withdrawAmount),
      ).to.be.revertedWithCustomError(Paymaster, 'OwnableUnauthorizedAccount');
    });

    it('Should revert with zero amount', async () => {
      await expect(
        Paymaster.withdraw(owner.address, 0),
      ).to.be.revertedWithCustomError(Paymaster, 'ZeroTokenAmount');
    });

    it('Should revert with insufficient balance', async () => {
      const tooMuch = parseEther('200');
      await expect(
        Paymaster.withdraw(owner.address, tooMuch),
      ).to.be.revertedWithCustomError(Paymaster, 'TooLowBalance');
    });
  });

  describe('Cover Cost', () => {
    const coverAmount = parseEther('30');

    beforeEach(async () => {
      // Fund the paymaster first
      await Token.connect(user).approve(
        Paymaster.getAddress(),
        parseEther('100'),
      );
      await Paymaster.connect(user).fundPaymaster(parseEther('100'));
      // Add allowed address
      await Paymaster.addAllowedAddress(user.address);
    });

    it('Should allow allowed address to cover cost', async () => {
      await expect(Paymaster.connect(user).coverCost(coverAmount))
        .to.emit(Token, 'Transfer')
        .withArgs(
          await Paymaster.getAddress(),
          knowledgeCollectionAddress,
          coverAmount,
        );
    });

    it('Should revert when non-allowed address tries to cover cost', async () => {
      const nonAllowed = accounts[4];
      await expect(
        Paymaster.connect(nonAllowed).coverCost(coverAmount),
      ).to.be.revertedWithCustomError(Paymaster, 'NotAllowed');
    });

    it('Should revert with zero amount', async () => {
      await expect(
        Paymaster.connect(user).coverCost(0),
      ).to.be.revertedWithCustomError(Paymaster, 'ZeroTokenAmount');
    });

    it('Should revert with insufficient balance', async () => {
      const tooMuch = parseEther('200');
      await expect(
        Paymaster.connect(user).coverCost(tooMuch),
      ).to.be.revertedWithCustomError(Paymaster, 'TooLowBalance');
    });
  });
});
