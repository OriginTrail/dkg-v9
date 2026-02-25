import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Token } from '../typechain/contracts/Token';

type TestTokenDeploymentParameters = {
  tokenAddress: string;
  receiver: string;
  amount: string;
};

task('mint_test_tokens', 'Mint Test Trace Tokens')
  .addParam<string>('tokenAddress', 'Token Address')
  .addParam<string>('receiver', 'Receiver Address')
  .addParam<string>('amount', 'Amount of tokens to mint')
  .setAction(
    async (
      taskArgs: TestTokenDeploymentParameters,
      hre: HardhatRuntimeEnvironment,
    ) => {
      const { tokenAddress, receiver, amount } = taskArgs;
      const { minter } = await hre.getNamedAccounts();

      const Token: Token = await hre.ethers.getContractAt(
        'Token',
        tokenAddress,
      );

      const minterRole = await Token.MINTER_ROLE();
      if (!(await Token.hasRole(minterRole, minter))) {
        console.log(`Granting minter role for ${minter}.`);
        const setupMinterTx = await Token['grantRole(address)'](minter);
        await setupMinterTx.wait();
      }

      const amountToMint = hre.ethers.parseEther(amount);

      const mintTx = await Token.mint(receiver, amountToMint, { from: minter });
      await mintTx.wait();

      const tokenSymbol = await Token.symbol();

      console.log(
        `${amountToMint.toString()} $${tokenSymbol} has been minted to ${tokenAddress} on the ${
          hre.network.name
        } blockchain!`,
      );
    },
  );
