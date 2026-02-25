import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'Staking',
  });
};

export default func;
func.tags = ['Staking'];
func.dependencies = [
  'Hub',
  'ShardingTable',
  'IdentityStorage',
  'ParametersStorage',
  'ProfileStorage',
  'ServiceAgreementStorageProxy',
  'ShardingTableStorage',
  'StakingStorage',
  'NodeOperatorFeesStorage',
  'Ask',
  'DelegatorsInfo',
  'Chronos',
  'RandomSamplingStorage',
  'EpochStorage',
];
