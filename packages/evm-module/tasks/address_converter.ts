import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type ConverterParameters = {
  address: string;
};

task('convert_evm_address', 'Converts EVM address to Substrate address')
  .addParam<string>('address', 'EVM address')
  .setAction(
    async (taskArgs: ConverterParameters, hre: HardhatRuntimeEnvironment) => {
      const ss58Address = hre.helpers.convertEvmWallet(taskArgs.address);

      console.log(
        `Substrate Address is ${ss58Address} for EVM address ${taskArgs.address}.`,
      );
    },
  );
