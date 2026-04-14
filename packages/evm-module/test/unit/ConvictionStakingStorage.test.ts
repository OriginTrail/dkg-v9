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

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({ accounts, ConvictionStakingStorage, Chronos } = await loadFixture(deployFixture));
  });

  it('Should have correct name and version', async () => {
    expect(await ConvictionStakingStorage.name()).to.equal('ConvictionStakingStorage');
    expect(await ConvictionStakingStorage.version()).to.equal('1.0.0');
  });
});
