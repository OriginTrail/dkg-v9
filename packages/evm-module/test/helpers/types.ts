import { HardhatEthersSigner as SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

export type NodeAccounts = {
  admin: SignerWithAddress;
  operational: SignerWithAddress;
};

export type KCSignaturesData = {
  merkleRoot: string;
  publisherR: string;
  publisherVS: string;
  receiverRs: string[];
  receiverVSs: string[];
};
