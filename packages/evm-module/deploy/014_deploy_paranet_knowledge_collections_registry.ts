import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'ParanetKnowledgeCollectionsRegistry',
  });
};

export default func;
func.tags = ['ParanetKnowledgeCollectionsRegistry'];
func.dependencies = ['Hub'];
