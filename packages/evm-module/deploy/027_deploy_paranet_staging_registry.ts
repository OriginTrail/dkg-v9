import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'ParanetStagingRegistry',
  });
};

export default func;
func.tags = ['ParanetStagingRegistry'];
func.dependencies = ['Hub'];
