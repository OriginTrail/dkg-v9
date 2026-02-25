import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'MigratorV6Epochs9to12Rewards',
  });
};

export default func;
func.tags = ['MigratorV6Epochs9to12Rewards'];
func.dependencies = [
  'Hub',
  'StakingStorage',
  'ShardingTableStorage',
  'ShardingTable',
  'ParametersStorage',
  'Ask',
  'DelegatorsInfo',
  'Chronos',
  'Staking',
  'ProfileStorage',
  'IdentityStorage',
  'Token',
  'Profile',
];
