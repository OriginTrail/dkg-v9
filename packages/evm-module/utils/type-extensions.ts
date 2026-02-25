/* eslint-disable  @typescript-eslint/consistent-type-definitions */
import 'hardhat/types/config';
import 'hardhat/types/runtime';

import { Helpers } from './helpers';

declare module 'hardhat/types/config' {
  export interface HardhatNetworkConfig {
    environment: string;
  }

  export interface HardhatNetworkUserConfig {
    environment: string;
  }

  export interface HttpNetworkConfig {
    environment: string;
  }

  export interface HttpNetworkUserConfig {
    environment: string;
  }
}

declare module 'hardhat/types/runtime' {
  export interface HardhatRuntimeEnvironment {
    helpers: Helpers;
  }
}
