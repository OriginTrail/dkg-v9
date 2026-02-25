import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'Paranet',
  });
};

export default func;
func.tags = ['Paranet'];
func.dependencies = [
  'Hub',
  'ParanetKnowledgeCollectionsRegistry',
  'ParanetKnowledgeMinersRegistry',
  'ParanetsRegistry',
  'ParanetServicesRegistry',
  'ParanetStagingRegistry',
  'ProfileStorage',
  'IdentityStorage',
];
