import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type EncoderParameters = {
  contractName: string;
  functionName: string;
  functionArgs: Array<string>;
};

task(
  'encode_data',
  'Encodes data needed for low-level contract call from HubController',
)
  .addParam<string>('contractName')
  .addParam<string>('functionName')
  .addOptionalVariadicPositionalParam<Array<string>>('functionArgs')
  .setAction(
    async (taskArgs: EncoderParameters, hre: HardhatRuntimeEnvironment) => {
      const contractInterface = new hre.ethers.Interface(
        hre.helpers.getAbi(taskArgs.contractName),
      );
      const encodedData = contractInterface.encodeFunctionData(
        taskArgs.functionName,
        taskArgs.functionArgs,
      );

      console.log(encodedData);
    },
  );
