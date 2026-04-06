/**
 * Targeted Hardhat cases for 07_EVM_MODULE: publishing conviction boundaries and
 * access control invariants (complements existing ContextGraphs / PCA suites).
 */
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

import { Hub, PublishingConvictionAccount } from '../../typechain';

type PcaFixture = {
  accounts: SignerWithAddress[];
  Hub: Hub;
  PCA: PublishingConvictionAccount;
};

describe('@unit V10 targeted — PublishingConvictionAccount boundaries', () => {
  let accounts: SignerWithAddress[];
  let PCA: PublishingConvictionAccount;

  async function deployPca(): Promise<PcaFixture> {
    await hre.deployments.fixture(['PublishingConvictionAccount']);
    const Hub = await hre.ethers.getContract<Hub>('Hub');
    const PCA = await hre.ethers.getContract<PublishingConvictionAccount>('PublishingConvictionAccount');
    const signers = await hre.ethers.getSigners();
    await Hub.setContractAddress('HubOwner', signers[0].address);
    return { accounts: signers, Hub, PCA };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    const f = await loadFixture(deployPca);
    accounts = f.accounts;
    PCA = f.PCA;
  });

  it('reverts createAccount when amount is zero (InvalidAmount)', async () => {
    const token = await hre.ethers.getContract('Token');
    await token.approve(await PCA.getAddress(), 1);
    await expect(PCA.createAccount(0, 6)).to.be.revertedWithCustomError(PCA, 'InvalidAmount');
  });

  it('reverts createAccount when lockEpochs is zero (InvalidLockEpochs)', async () => {
    const token = await hre.ethers.getContract('Token');
    const amount = hre.ethers.parseEther('1000');
    await token.approve(await PCA.getAddress(), amount);
    await expect(PCA.createAccount(amount, 0)).to.be.revertedWithCustomError(
      PCA,
      'InvalidLockEpochs',
    );
  });

  it('reverts addAuthorizedKey from non-admin (NotAccountAdmin)', async () => {
    const token = await hre.ethers.getContract('Token');
    const amount = hre.ethers.parseEther('100000');
    await token.approve(await PCA.getAddress(), amount);
    await PCA.createAccount(amount, 6);

    await expect(
      PCA.connect(accounts[2]).addAuthorizedKey(1, accounts[3].address),
    ).to.be.revertedWithCustomError(PCA, 'NotAccountAdmin');
  });
});
