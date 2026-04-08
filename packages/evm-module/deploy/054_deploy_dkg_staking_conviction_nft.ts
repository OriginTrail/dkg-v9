import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

/**
 * DKGStakingConvictionNFT is not yet integrated with the staking protocol
 * (no stakeOnBehalf in Staking.sol). Deployed for testing but excluded from
 * the 'v10' production tag. Re-add 'v10' tag once staking integration is done.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await hre.helpers.deploy({
    newContractName: 'DKGStakingConvictionNFT',
  });
};

export default func;
func.tags = ['DKGStakingConvictionNFT'];
func.dependencies = ['Hub', 'Token'];
