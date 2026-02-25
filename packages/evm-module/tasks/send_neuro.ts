import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type SenderParameters = {
  neuro_address: string;
  amount: number;
};

task(
  'send_neuro',
  'Sends Neuro from account with tokens to the specified (Substrate) address',
)
  .addParam<string>('neuroAddress', 'Substrate Neuroweb address')
  .addParam<number>('amount', 'Amount of tokens to send')
  .setAction(
    async (taskArgs: SenderParameters, hre: HardhatRuntimeEnvironment) => {
      hre.helpers.sendNeuro(taskArgs.neuro_address, taskArgs.amount);
    },
  );
