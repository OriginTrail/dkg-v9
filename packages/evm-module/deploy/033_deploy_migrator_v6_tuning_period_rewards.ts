import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'MigratorV6TuningPeriodRewards',
  });
};

export default func;
func.tags = ['MigratorV6TuningPeriodRewards'];
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
