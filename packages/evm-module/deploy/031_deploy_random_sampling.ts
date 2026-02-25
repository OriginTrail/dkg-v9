import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'RandomSampling',
  });
};

export default func;
func.tags = ['RandomSampling'];
func.dependencies = [
  'Hub',
  'Chronos',
  'RandomSamplingStorage',
  'StakingStorage',
  'ProfileStorage',
  'EpochStorage',
  'AskStorage',
  'DelegatorsInfo',
  'KnowledgeCollectionStorage',
  'IdentityStorage',
  'ShardingTableStorage',
  'ParametersStorage',
];
