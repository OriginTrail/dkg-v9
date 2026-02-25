// import { HardhatRuntimeEnvironment } from 'hardhat/types';
// import { DeployFunction } from 'hardhat-deploy/types';

// const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
//   const oldHubAddress =
//     hre.helpers.contractDeployments.contracts['OldHub']?.evmAddress;
//   const V8HubAddress =
//     hre.helpers.contractDeployments.contracts['Hub']?.evmAddress;

//   if (hre.network.config.environment === 'development' || !oldHubAddress) {
//     console.log(
//       'Skipping MigratorM1V8 deployment: development environment or missing old hub address',
//     );
//     return;
//   }

//   console.log(`Deploying MigratorM1V8 with:`);
//   console.log(`  New Hub: ${V8HubAddress}`);
//   console.log(`  Old Hub: ${oldHubAddress}`);

//   const MigratorM1V8 = await hre.helpers.deploy({
//     newContractName: 'MigratorM1V8',
//     passHubInConstructor: false,
//     additionalArgs: [V8HubAddress, oldHubAddress],
//   });

//   // Set up initialization calls for the migrator
//   // These will be executed after deployment to connect to old and new contract systems
//   hre.helpers.setParametersEncodedData.push({
//     contractName: 'MigratorM1V8',
//     encodedData: [
//       MigratorM1V8.interface.encodeFunctionData('initializeOldContracts', []),
//       MigratorM1V8.interface.encodeFunctionData('initializeNewContracts', []),
//     ],
//   });

//   console.log(`MigratorM1V8 deployed at: ${await MigratorM1V8.getAddress()}`);
// };

// export default func;
// func.tags = ['MigratorM1V8'];
// func.dependencies = [
//   'Hub',
//   'IdentityStorage',
//   'ProfileStorage',
//   'StakingStorage',
//   'Ask',
// ];
