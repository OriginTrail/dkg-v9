import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type TestTokenDeploymentParameters = {
  tokenName: string;
  tokenSymbol: string;
};

task('deploy_test_token', 'Deploy Test Trace Token')
  .addParam<string>('tokenName', 'Token Name')
  .addParam<string>('tokenSymbol', 'Token Symbol')
  .setAction(
    async (
      taskArgs: TestTokenDeploymentParameters,
      hre: HardhatRuntimeEnvironment,
    ) => {
      const { tokenName, tokenSymbol } = taskArgs;

      const TokenFactory = await hre.ethers.getContractFactory('Token');
      const deployment = await TokenFactory.deploy(tokenName, tokenSymbol);
      const Token = await deployment.waitForDeployment();

      const tokenAddress = await Token.getAddress();

      console.log(
        `${tokenName} ($${tokenSymbol}) token has been deployed to: ${
          tokenAddress
        } on the ${hre.network.name} blockchain!`,
      );
    },
  );
