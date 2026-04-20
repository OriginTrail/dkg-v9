/**
 * DKG v10 Hub audit coverage.
 *
 * Findings covered (see .test-audit/BUGS_FOUND.md):
 *   E-1 (CRITICAL, SPEC-GAP): `Hub.setAndReinitializeContracts` atomic V10
 *        mainnet-swap mechanism — partial-failure rollback, non-owner revert,
 *        happy-path success.
 *   E-7 (HIGH, PROD-BUG):     `Hub._setContractAddress` emits `NewContract`
 *        TWICE on the new-contract branch. Test counts emitted `NewContract`
 *        events and asserts EXACTLY 1 — left RED until the duplicate emit
 *        at Hub.sol:204 is removed.
 *
 * Do NOT modify production code from these tests. Any red assertion is the
 * finding being surfaced; leave it red and reference BUGS_FOUND.md.
 */

import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

import {
  DKGStakingConvictionNFT,
  Hub,
  ParametersStorage,
  Token,
} from '../../typechain';

type HubAuditFixture = {
  accounts: SignerWithAddress[];
  Hub: Hub;
  ParametersStorage: ParametersStorage;
  Token: Token;
};

describe('@unit v10 Hub audit', function () {
  let accounts: SignerWithAddress[];
  let HubContract: Hub;
  let ParametersStorageContract: ParametersStorage;

  async function deployFixture(): Promise<HubAuditFixture> {
    await hre.deployments.fixture(['Hub', 'ParametersStorage', 'Token']);
    const Hub = await hre.ethers.getContract<Hub>('Hub');
    const ParametersStorageC = await hre.ethers.getContract<ParametersStorage>(
      'ParametersStorage',
    );
    const Token = await hre.ethers.getContract<Token>('Token');
    const accounts = await hre.ethers.getSigners();
    // Register HubOwner so any `onlyOwnerOrMultiSigOwner` downstream passes
    // for the deployer.
    await Hub.setContractAddress('HubOwner', accounts[0].address);
    return {
      accounts,
      Hub,
      ParametersStorage: ParametersStorageC,
      Token,
    };
  }

  beforeEach(async () => {
    hre.helpers.resetDeploymentsJson();
    ({
      accounts,
      Hub: HubContract,
      ParametersStorage: ParametersStorageContract,
    } = await loadFixture(deployFixture));
  });

  // ========================================================================
  // E-7 (HIGH, PROD-BUG): duplicate `NewContract` emission
  // ========================================================================

  describe('E-7 — `Hub._setContractAddress` must emit `NewContract` exactly once on create', () => {
    it('emits NewContract EXACTLY 1 time when adding a fresh contract name', async () => {
      const tx = await HubContract.setContractAddress(
        'E7TestContract',
        accounts[5].address,
      );
      const receipt = await tx.wait();
      const topic = HubContract.interface.getEvent('NewContract').topicHash;
      const newContractLogs = receipt!.logs.filter(
        (l) =>
          l.address.toLowerCase() ===
            (HubContract.target as string).toLowerCase() &&
          l.topics[0] === topic,
      );
      // BUG E-7: contract currently emits `NewContract` twice on the new-name
      // branch (Hub.sol:193 in the `else` branch + unconditional Hub.sol:204).
      // This assertion is intentionally left RED — fixing the contract to
      // emit once is the remediation. See BUGS_FOUND.md#E-7.
      expect(
        newContractLogs.length,
        'NewContract emitted more than once on create (BUGS_FOUND.md#E-7)',
      ).to.equal(1);
    });

    it('emits NewContract EXACTLY 1 time when updating an existing contract name', async () => {
      // First create — use a fresh tx so we only measure the UPDATE tx.
      await HubContract.setContractAddress(
        'E7UpdateContract',
        accounts[5].address,
      );

      const tx = await HubContract.setContractAddress(
        'E7UpdateContract',
        accounts[6].address,
      );
      const receipt = await tx.wait();
      const newContractTopic =
        HubContract.interface.getEvent('NewContract').topicHash;
      const changedTopic =
        HubContract.interface.getEvent('ContractChanged').topicHash;
      const addr = (HubContract.target as string).toLowerCase();
      const newContractLogs = receipt!.logs.filter(
        (l) => l.address.toLowerCase() === addr && l.topics[0] === newContractTopic,
      );
      const changedLogs = receipt!.logs.filter(
        (l) => l.address.toLowerCase() === addr && l.topics[0] === changedTopic,
      );
      // Spec: update path should emit ContractChanged (1x) — NewContract is
      // the wrong event on update. The unconditional emit at Hub.sol:204 also
      // fires on update, which is a duplicate signal downstream indexers must
      // dedupe. Per spec the update branch should emit `ContractChanged`
      // exclusively (count = 0 for NewContract).
      expect(changedLogs.length).to.equal(1);
      expect(
        newContractLogs.length,
        'NewContract incorrectly emitted on update path (BUGS_FOUND.md#E-7)',
      ).to.equal(0);
    });
  });

  // ========================================================================
  // E-1 (CRITICAL, SPEC-GAP): setAndReinitializeContracts atomicity
  // ========================================================================

  describe('E-1 — `Hub.setAndReinitializeContracts` atomic contract swap', () => {
    it('non-owner cannot call setAndReinitializeContracts', async () => {
      const HubAsNonOwner = HubContract.connect(accounts[1]);
      // HubLib.UnauthorizedAccess("Only Hub Owner or Multisig Owner") is the
      // concrete selector — use low-level `.reverted` since the custom error
      // is declared in a library and the Hub typechain doesn't re-export it.
      await expect(
        HubAsNonOwner.setAndReinitializeContracts([], [], [], []),
      ).to.be.reverted;
    });

    it('success path: sets new contracts and re-initializes them', async () => {
      // Deploy a disposable DKGStakingConvictionNFT whose `initialize()`
      // tolerates missing StakingStorage/Chronos and reads Token from the
      // Hub. This exercises the full setAndReinitializeContracts sequence.
      const NFTFactory = await hre.ethers.getContractFactory(
        'DKGStakingConvictionNFT',
      );
      const freshNFT = (await NFTFactory.deploy(
        await HubContract.getAddress(),
      )) as unknown as DKGStakingConvictionNFT;
      await freshNFT.waitForDeployment();
      const freshNFTAddr = await freshNFT.getAddress();

      const tx = await HubContract.setAndReinitializeContracts(
        [{ name: 'E1StakingNFT', addr: freshNFTAddr }],
        [],
        [freshNFTAddr],
        [],
      );
      const receipt = await tx.wait();
      expect(receipt!.status).to.equal(1);

      expect(
        await HubContract.getContractAddress('E1StakingNFT'),
      ).to.equal(freshNFTAddr);
      expect(
        await HubContract['isContract(string)']('E1StakingNFT'),
      ).to.equal(true);
      // initialize wired Token correctly.
      const tokenAddr = await HubContract.getContractAddress('Token');
      expect(await freshNFT.tokenContract()).to.equal(tokenAddr);
    });

    it('partial-failure rollback: if any reinit reverts, all registrations are rolled back', async () => {
      // The hardhat deployment fixture has no contract named "E1RollbackA" yet;
      // after the failed tx, it must remain unknown. We force a reinit failure
      // by passing an EOA as the reinit target (Solidity high-level call to
      // EOA reverts via extcodesize check).
      const eoaTarget = accounts[7].address;

      // Deploy a real ParametersStorage so phase-1 registrations look healthy
      // (addr is a contract that supports setStatus). This isolates the
      // failure to phase-3 (_reinitializeContracts).
      const PSFactory = await hre.ethers.getContractFactory(
        'ParametersStorage',
      );
      const realPS = (await PSFactory.deploy(
        await HubContract.getAddress(),
        0,
      )) as unknown as ParametersStorage;
      await realPS.waitForDeployment();

      await expect(
        HubContract.setAndReinitializeContracts(
          [{ name: 'E1RollbackA', addr: await realPS.getAddress() }],
          [],
          [eoaTarget],
          [],
        ),
      ).to.be.reverted;

      // Atomicity: "E1RollbackA" must not be registered after the revert.
      expect(
        await HubContract['isContract(string)']('E1RollbackA'),
      ).to.equal(false);
      await expect(
        HubContract.getContractAddress('E1RollbackA'),
      ).to.be.revertedWithCustomError(HubContract, 'ContractDoesNotExist');
    });

    it('partial-failure rollback preserves pre-existing registrations', async () => {
      await HubContract.setContractAddress(
        'E1Preexisting',
        accounts[5].address,
      );
      expect(await HubContract.getContractAddress('E1Preexisting')).to.equal(
        accounts[5].address,
      );

      const PSFactory = await hre.ethers.getContractFactory(
        'ParametersStorage',
      );
      const realPS = (await PSFactory.deploy(
        await HubContract.getAddress(),
        0,
      )) as unknown as ParametersStorage;
      await realPS.waitForDeployment();
      const eoaTarget = accounts[8].address;

      await expect(
        HubContract.setAndReinitializeContracts(
          [
            { name: 'E1Preexisting', addr: accounts[6].address },
            { name: 'E1NewName', addr: await realPS.getAddress() },
          ],
          [],
          [eoaTarget],
          [],
        ),
      ).to.be.reverted;

      // Pre-existing registration must be unchanged (no flipped address).
      expect(await HubContract.getContractAddress('E1Preexisting')).to.equal(
        accounts[5].address,
      );
      // New name must be absent.
      expect(await HubContract['isContract(string)']('E1NewName')).to.equal(
        false,
      );
    });
  });
});
