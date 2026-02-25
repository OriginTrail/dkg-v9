import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'KnowledgeCollection',
  });
};

export default func;
func.tags = ['KnowledgeCollection'];
func.dependencies = [
  'Hub',
  'Chronos',
  'ShardingTableStorage',
  'KnowledgeCollectionStorage',
  'ParametersStorage',
  'IdentityStorage',
  'PaymasterManager',
];
