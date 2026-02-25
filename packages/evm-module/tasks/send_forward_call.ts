import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type ForwardCallParameters = {
  target: string;
  encodedData: string;
};

task('send_forward_call', 'Sends forward call from the Hub')
  .addParam<string>('target', 'Target contract for forward call')
  .addParam<string>('encodedData', 'Encoded data for forwards call')
  .setAction(
    async (taskArgs: ForwardCallParameters, hre: HardhatRuntimeEnvironment) => {
      const { target, encodedData } = taskArgs;

      const HubAbi = hre.helpers.getAbi('Hub');
      const hubAddress =
        hre.helpers.contractDeployments.contracts['Hub'].evmAddress;
      const Hub = await hre.ethers.getContractAt(HubAbi, hubAddress);

      const tx = await Hub.forwardCall(target, encodedData);
      await tx.wait();
    },
  );
