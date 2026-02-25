import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'Ask',
  });
};

export default func;
func.tags = ['Ask'];
func.dependencies = [
  'Hub',
  'AskStorage',
  'ShardingTableStorage',
  'ParametersStorage',
  'StakingStorage',
  'ProfileStorage',
];
