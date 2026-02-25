import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type EncoderParameters = {
  signature: string;
};

task('encode_selector', 'Calculates EVM function/error selector (sighash)')
  .addParam<string>('signature')
  .setAction(
    async (taskArgs: EncoderParameters, hre: HardhatRuntimeEnvironment) => {
      const sighash = hre.ethers.dataSlice(
        hre.ethers.keccak256(hre.ethers.toUtf8Bytes(taskArgs.signature)),
        0,
        4,
      );

      console.log(`Selector (sighash) for ${taskArgs.signature}: ${sighash}`);
    },
  );
