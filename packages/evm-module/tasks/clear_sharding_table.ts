import fs from 'fs/promises';

import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type ConverterParameters = {
  filePath: string;
};

task(
  'clear_sharding_table',
  'Removed nodes from sharding table by node IDs from the CSV file',
)
  .addParam<string>('filePath', 'Path to CSV file with Node IDs')
  .setAction(
    async (taskArgs: ConverterParameters, hre: HardhatRuntimeEnvironment) => {
      const { filePath } = taskArgs;

      let nodeIdsToDelete: string[];
      try {
        const data = await fs.readFile(filePath, 'utf8');
        nodeIdsToDelete = data
          .trim()
          .split('\n')
          .map((row) => row.split(',')[0]);
      } catch (err) {
        console.error(err);
        nodeIdsToDelete = [];
      }

      const ShardingTableABI = hre.helpers.getAbi('ShardingTable');
      const shardingTableAddress =
        hre.helpers.contractDeployments.contracts['ShardingTable'].evmAddress;
      const ShardingTable = await hre.ethers.getContractAt(
        ShardingTableABI,
        shardingTableAddress,
      );

      const table = await ShardingTable['getShardingTable()']();

      for (const node of table) {
        const nodeIdString = hre.ethers.toUtf8String(node.nodeId);

        if (nodeIdsToDelete.includes(nodeIdString)) {
          console.log(`Deleting node with identityId: ${node.identityId}`);

          await ShardingTable.removeNode(node.identityId);
        }
      }
    },
  );
