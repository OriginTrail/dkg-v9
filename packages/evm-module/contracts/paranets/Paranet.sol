// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {ParanetKnowledgeCollectionsRegistry} from "../storage/paranets/ParanetKnowledgeCollectionsRegistry.sol";
import {ParanetKnowledgeMinersRegistry} from "../storage/paranets/ParanetKnowledgeMinersRegistry.sol";
import {ParanetsRegistry} from "../storage/paranets/ParanetsRegistry.sol";
import {ParanetServicesRegistry} from "../storage/paranets/ParanetServicesRegistry.sol";
import {ParanetStagingRegistry} from "../storage/paranets/ParanetStagingRegistry.sol";
import {ProfileStorage} from "../storage/ProfileStorage.sol";
import {IdentityStorage} from "../storage/IdentityStorage.sol";
import {KnowledgeCollectionStorage} from "../storage/KnowledgeCollectionStorage.sol";
import {Chronos} from "../storage/Chronos.sol";
import {ContractStatus} from "../abstract/ContractStatus.sol";
import {IInitializable} from "../interfaces/IInitializable.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";
import {ParanetLib} from "../libraries/ParanetLib.sol";
import {ProfileLib} from "../libraries/ProfileLib.sol";
import {KnowledgeCollectionLib} from "../libraries/KnowledgeCollectionLib.sol";

contract Paranet is INamed, IVersioned, ContractStatus, IInitializable {
    // Access Policy Constants
    uint8 private constant NODES_ACCESS_POLICY_OPEN = 0;
    uint8 private constant NODES_ACCESS_POLICY_PERMISSIONED = 1;

    uint8 private constant MINERS_ACCESS_POLICY_OPEN = 0;
    uint8 private constant MINERS_ACCESS_POLICY_PERMISSIONED = 1;

    uint8 private constant KNOWLEDGE_COLLECTIONS_SUBMISSION_POLICY_OPEN = 0;
    uint8 private constant KNOWLEDGE_COLLECTIONS_SUBMISSION_POLICY_STAGING = 1;

    event ParanetRegistered(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed parnetKATokenId,
        string paranetName,
        string paranetDescription,
        uint8 nodesAccessPolicy,
        uint8 minersAccessPolicy,
        uint8 knowledgeCollectionsSubmissionPolicy
    );
    event ParanetPermissionedNodeAdded(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        uint72 identityId
    );
    event ParanetPermissionedNodeRemoved(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        uint72 identityId
    );
    event ParanetPermissionedNodeJoinRequestCreated(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        uint72 identityId
    );
    event ParanetPermissionedNodeJoinRequestAccepted(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        uint72 identityId
    );
    event ParanetPermissionedNodeJoinRequestRejected(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        uint72 identityId
    );
    event ParanetIncetivesPoolDeployed(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        ParanetLib.IncentivesPool incentivesPool
    );
    event ParanetMetadataUpdated(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        string newParanetName,
        string newParanetDescription
    );
    event ParanetServiceAdded(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        address paranetServiceKCStorageContract,
        uint256 paranetServiceKCTokenId,
        uint256 paranetServiceKATokenId
    );
    event ParanetServiceRegistered(
        address indexed paranetServiceKCStorageContract,
        uint256 indexed paranetServiceKCTokenId,
        uint256 indexed paranetServiceKATokenId,
        string paranetServiceName,
        string paranetServiceDescription,
        address[] paranetServiceAddresses
    );
    event ParanetServiceMetadataUpdated(
        address indexed paranetServiceKCStorageContract,
        uint256 indexed paranetServiceKCTokenId,
        uint256 indexed paranetServiceKATokenId,
        string newParanetServiceName,
        string newParanetServiceDescription,
        address[] newParanetServiceAddresses
    );
    event KnowledgeCollectionSubmittedToParanet(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionId
    );
    event ParanetPermissionedMinerAdded(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        address minerAddress
    );
    event ParanetPermissionedMinerRemoved(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        address minerAddress
    );
    event ParanetPermissionedMinerAccessRequestCreated(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        address minerAddress
    );
    event ParanetPermissionedMinerAccessRequestAccepted(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        address minerAddress
    );
    event ParanetPermissionedMinerAccessRequestRejected(
        address indexed paranetKCStorageContract,
        uint256 indexed paranetKCTokenId,
        uint256 indexed paranetKATokenId,
        address minerAddress
    );

    string private constant _NAME = "Paranet";
    string private constant _VERSION = "1.0.0";

    ParanetsRegistry public paranetsRegistry;
    ParanetServicesRegistry public paranetServicesRegistry;
    ParanetKnowledgeMinersRegistry public paranetKnowledgeMinersRegistry;
    ParanetKnowledgeCollectionsRegistry public paranetKnowledgeCollectionsRegistry;
    ParanetStagingRegistry public paranetStagingRegistry;
    ProfileStorage public profileStorage;
    IdentityStorage public identityStorage;
    Chronos public chronos;

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) ContractStatus(hubAddress) {}

    modifier onlyKnowledgeAssetOwner(
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId,
        uint256 knowledgeAssetTokenId
    ) {
        _checkKnowledgeAssetOwner(
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId,
            knowledgeAssetTokenId
        );
        _;
    }

    modifier onlyKnowledgeCollectionOwner(
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId
    ) {
        _checkKnowledgeCollectionOwner(knowledgeCollectionStorageContract, knowledgeCollectionTokenId);
        _;
    }

    modifier onlyCurator(
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId
    ) {
        _checkCurator(paranetKCStorageContract, paranetKnowledgeCollectionTokenId, paranetKnowledgeAssetTokenId);
        _;
    }

    function initialize() public onlyHub {
        profileStorage = ProfileStorage(hub.getContractAddress("ProfileStorage"));
        identityStorage = IdentityStorage(hub.getContractAddress("IdentityStorage"));
        paranetsRegistry = ParanetsRegistry(hub.getContractAddress("ParanetsRegistry"));
        paranetServicesRegistry = ParanetServicesRegistry(hub.getContractAddress("ParanetServicesRegistry"));
        paranetKnowledgeMinersRegistry = ParanetKnowledgeMinersRegistry(
            hub.getContractAddress("ParanetKnowledgeMinersRegistry")
        );
        paranetKnowledgeCollectionsRegistry = ParanetKnowledgeCollectionsRegistry(
            hub.getContractAddress("ParanetKnowledgeCollectionsRegistry")
        );
        paranetStagingRegistry = ParanetStagingRegistry(hub.getContractAddress("ParanetStagingRegistry"));
        chronos = Chronos(hub.getContractAddress("Chronos"));
    }

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    function registerParanet(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        string calldata paranetName,
        string calldata paranetDescription,
        uint8 nodesAccessPolicy,
        uint8 minersAccessPolicy,
        uint8 knowledgeCollectionsSubmissionPolicy
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) returns (bytes32) {
        require(
            nodesAccessPolicy < 2 && minersAccessPolicy < 2 && knowledgeCollectionsSubmissionPolicy < 2,
            "Invalid policy"
        );
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        require(!paranetsRegistry.paranetExists(paranetId), "Paranet does not exist");

        emit ParanetRegistered(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            paranetName,
            paranetDescription,
            nodesAccessPolicy,
            minersAccessPolicy,
            knowledgeCollectionsSubmissionPolicy
        );

        return
            pr.registerParanet(
                paranetKCStorageContract,
                paranetKCTokenId,
                paranetKATokenId,
                paranetName,
                paranetDescription,
                nodesAccessPolicy,
                minersAccessPolicy,
                knowledgeCollectionsSubmissionPolicy
            );
    }

    function updateParanetMetadata(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        string calldata paranetName,
        string calldata paranetDescription
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);
        pr.setName(paranetId, paranetName);
        pr.setDescription(paranetId, paranetDescription);

        emit ParanetMetadataUpdated(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            paranetName,
            paranetDescription
        );
    }

    function addParanetPermissionedNodes(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        uint72[] calldata identityIds
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;
        ProfileStorage ps = profileStorage;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getNodesAccessPolicy(paranetId) != NODES_ACCESS_POLICY_PERMISSIONED) {
            // TODO: Why is this 1 element array
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = NODES_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetNodesAccessPolicy(
                expectedAccessPolicies,
                pr.getNodesAccessPolicy(paranetId)
            );
        }

        for (uint256 i; i < identityIds.length; ) {
            if (!ps.profileExists(identityIds[i])) {
                revert ProfileLib.ProfileDoesntExist(identityIds[i]);
            }

            if (pr.isPermissionedNode(paranetId, identityIds[i])) {
                revert ParanetLib.ParanetPermissionedNodeHasAlreadyBeenAdded(paranetId, identityIds[i]);
            }

            pr.addPermissionedNode(paranetId, identityIds[i], ps.getNodeId(identityIds[i]));

            emit ParanetPermissionedNodeAdded(
                paranetKCStorageContract,
                paranetKCTokenId,
                paranetKATokenId,
                identityIds[i]
            );

            unchecked {
                i++;
            }
        }
    }

    function removeParanetPermissionedNodes(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        uint72[] calldata identityIds
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getNodesAccessPolicy(paranetId) != NODES_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = NODES_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetNodesAccessPolicy(
                expectedAccessPolicies,
                pr.getNodesAccessPolicy(paranetId)
            );
        }

        for (uint256 i; i < identityIds.length; ) {
            if (!pr.isPermissionedNode(paranetId, identityIds[i])) {
                revert ParanetLib.ParanetPermissionedNodeDoesntExist(paranetId, identityIds[i]);
            }

            pr.removePermissionedNode(paranetId, identityIds[i]);

            emit ParanetPermissionedNodeRemoved(
                paranetKCStorageContract,
                paranetKCTokenId,
                paranetKATokenId,
                identityIds[i]
            );

            unchecked {
                i++;
            }
        }
    }

    function requestParanetPermissionedNodeAccess(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId
    ) external {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getNodesAccessPolicy(paranetId) != NODES_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = NODES_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetNodesAccessPolicy(
                expectedAccessPolicies,
                pr.getNodesAccessPolicy(paranetId)
            );
        }

        uint72 identityId = identityStorage.getIdentityId(msg.sender);

        if (!profileStorage.profileExists(identityId)) {
            revert ProfileLib.ProfileDoesntExist(identityId);
        }

        ParanetLib.ParanetNodeJoinRequest[] memory paranetNodeJoinRequests = pr.getNodeJoinRequests(
            paranetId,
            identityId
        );

        if (
            paranetNodeJoinRequests.length > 0 &&
            paranetNodeJoinRequests[paranetNodeJoinRequests.length - 1].status == ParanetLib.RequestStatus.PENDING
        ) {
            revert ParanetLib.ParanetPermissionedNodeJoinRequestInvalidStatus(
                paranetId,
                identityId,
                paranetNodeJoinRequests[paranetNodeJoinRequests.length - 1].status
            );
        }

        pr.addNodeJoinRequest(paranetId, identityId, ParanetLib.RequestStatus.PENDING);

        emit ParanetPermissionedNodeJoinRequestCreated(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            identityId
        );
    }

    function approvePermissionedNode(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        uint72 identityId
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getNodesAccessPolicy(paranetId) != NODES_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = NODES_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetNodesAccessPolicy(
                expectedAccessPolicies,
                pr.getNodesAccessPolicy(paranetId)
            );
        }

        ParanetLib.ParanetNodeJoinRequest[] memory paranetNodeJoinRequests = pr.getNodeJoinRequests(
            paranetId,
            identityId
        );

        if (paranetNodeJoinRequests.length == 0) {
            revert ParanetLib.ParanetPermissionedNodeJoinRequestDoesntExist(paranetId, identityId);
        } else if (
            paranetNodeJoinRequests[paranetNodeJoinRequests.length - 1].status != ParanetLib.RequestStatus.PENDING
        ) {
            revert ParanetLib.ParanetPermissionedNodeJoinRequestInvalidStatus(
                paranetId,
                identityId,
                paranetNodeJoinRequests[paranetNodeJoinRequests.length - 1].status
            );
        }

        pr.updateNodeJoinRequestStatus(
            paranetId,
            identityId,
            paranetNodeJoinRequests.length - 1,
            ParanetLib.RequestStatus.APPROVED
        );
        pr.addPermissionedNode(paranetId, identityId, profileStorage.getNodeId(identityId));

        emit ParanetPermissionedNodeJoinRequestAccepted(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            identityId
        );
        emit ParanetPermissionedNodeAdded(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId, identityId);
    }

    function rejectPermissionedNode(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        uint72 identityId
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getNodesAccessPolicy(paranetId) != NODES_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = NODES_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetNodesAccessPolicy(
                expectedAccessPolicies,
                pr.getNodesAccessPolicy(paranetId)
            );
        }

        ParanetLib.ParanetNodeJoinRequest[] memory paranetNodeJoinRequests = pr.getNodeJoinRequests(
            paranetId,
            identityId
        );

        if (paranetNodeJoinRequests.length == 0) {
            revert ParanetLib.ParanetPermissionedNodeJoinRequestDoesntExist(paranetId, identityId);
        } else if (
            paranetNodeJoinRequests[paranetNodeJoinRequests.length - 1].status != ParanetLib.RequestStatus.PENDING
        ) {
            revert ParanetLib.ParanetPermissionedNodeJoinRequestInvalidStatus(
                paranetId,
                identityId,
                paranetNodeJoinRequests[paranetNodeJoinRequests.length - 1].status
            );
        }

        pr.updateNodeJoinRequestStatus(
            paranetId,
            identityId,
            paranetNodeJoinRequests.length - 1,
            ParanetLib.RequestStatus.REJECTED
        );

        emit ParanetPermissionedNodeJoinRequestRejected(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            identityId
        );
    }

    function addParanetServices(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        ParanetLib.UniversalAssetLocator[] calldata services
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;
        ParanetServicesRegistry psr = paranetServicesRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        for (uint256 i; i < services.length; ) {
            if (
                !psr.paranetServiceExists(
                    keccak256(
                        abi.encodePacked(
                            services[i].knowledgeCollectionStorageContract,
                            services[i].knowledgeCollectionTokenId,
                            services[i].knowledgeAssetTokenId
                        )
                    )
                )
            ) {
                revert ParanetLib.ParanetServiceDoesntExist(
                    services[i].knowledgeCollectionStorageContract,
                    services[i].knowledgeCollectionTokenId,
                    services[i].knowledgeAssetTokenId
                );
            }

            _checkKnowledgeAssetOwner(
                services[i].knowledgeCollectionStorageContract,
                services[i].knowledgeCollectionTokenId,
                services[i].knowledgeAssetTokenId
            );

            if (
                pr.isServiceImplemented(
                    paranetId,
                    keccak256(
                        abi.encodePacked(
                            services[i].knowledgeCollectionStorageContract,
                            services[i].knowledgeCollectionTokenId,
                            services[i].knowledgeAssetTokenId
                        )
                    )
                )
            ) {
                revert ParanetLib.ParanetServiceHasAlreadyBeenAdded(
                    paranetId,
                    keccak256(
                        abi.encodePacked(
                            services[i].knowledgeCollectionStorageContract,
                            services[i].knowledgeCollectionTokenId,
                            services[i].knowledgeAssetTokenId
                        )
                    )
                );
            }

            pr.addService(
                paranetId,
                keccak256(
                    abi.encodePacked(
                        services[i].knowledgeCollectionStorageContract,
                        services[i].knowledgeCollectionTokenId,
                        services[i].knowledgeAssetTokenId
                    )
                )
            );

            emit ParanetServiceAdded(
                paranetKCStorageContract,
                paranetKCTokenId,
                paranetKATokenId,
                services[i].knowledgeCollectionStorageContract,
                services[i].knowledgeCollectionTokenId,
                services[i].knowledgeAssetTokenId
            );

            unchecked {
                i++;
            }
        }
    }

    function registerParanetService(
        address paranetServiceKCStorageContract,
        uint256 paranetServiceKCTokenId,
        uint256 paranetServiceKATokenId,
        string calldata paranetServiceName,
        string calldata paranetServiceDescription,
        address[] calldata paranetServiceAddresses
    )
        external
        onlyKnowledgeAssetOwner(paranetServiceKCStorageContract, paranetServiceKCTokenId, paranetServiceKATokenId)
        returns (bytes32)
    {
        ParanetServicesRegistry psr = paranetServicesRegistry;

        bytes32 paranetServiceId = keccak256(
            abi.encodePacked(paranetServiceKCStorageContract, paranetServiceKCTokenId, paranetServiceKATokenId)
        );

        if (psr.paranetServiceExists(paranetServiceId)) {
            revert ParanetLib.ParanetServiceHasAlreadyBeenRegistered(
                paranetServiceKCStorageContract,
                paranetServiceKCTokenId,
                paranetServiceKATokenId
            );
        }

        emit ParanetServiceRegistered(
            paranetServiceKCStorageContract,
            paranetServiceKCTokenId,
            paranetServiceKATokenId,
            paranetServiceName,
            paranetServiceDescription,
            paranetServiceAddresses
        );

        return
            psr.registerParanetService(
                paranetServiceKCStorageContract,
                paranetServiceKCTokenId,
                paranetServiceKATokenId,
                paranetServiceName,
                paranetServiceDescription,
                paranetServiceAddresses
            );
    }

    function updateParanetServiceMetadata(
        address paranetServiceKCStorageContract,
        uint256 paranetServiceKCTokenId,
        uint256 paranetServiceKATokenId,
        string calldata paranetServiceName,
        string calldata paranetServiceDescription,
        address[] calldata paranetServiceAddresses
    )
        external
        onlyKnowledgeAssetOwner(paranetServiceKCStorageContract, paranetServiceKCTokenId, paranetServiceKATokenId)
    {
        ParanetServicesRegistry psr = paranetServicesRegistry;

        bytes32 paranetServiceId = keccak256(
            abi.encodePacked(paranetServiceKCStorageContract, paranetServiceKCTokenId, paranetServiceKATokenId)
        );

        if (!psr.paranetServiceExists(paranetServiceId)) {
            revert ParanetLib.ParanetServiceDoesntExist(
                paranetServiceKCStorageContract,
                paranetServiceKCTokenId,
                paranetServiceKATokenId
            );
        }

        psr.setName(paranetServiceId, paranetServiceName);
        psr.setDescription(paranetServiceId, paranetServiceDescription);
        psr.setParanetServiceAddresses(paranetServiceId, paranetServiceAddresses);

        emit ParanetServiceMetadataUpdated(
            paranetServiceKCStorageContract,
            paranetServiceKCTokenId,
            paranetServiceKATokenId,
            paranetServiceName,
            paranetServiceDescription,
            paranetServiceAddresses
        );
    }

    function addParanetPermissionedMiners(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        address[] calldata minerAddresses
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;
        ParanetKnowledgeMinersRegistry pkmr = paranetKnowledgeMinersRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getMinersAccessPolicy(paranetId) != MINERS_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = MINERS_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetMinersAccessPolicy(
                expectedAccessPolicies,
                pr.getMinersAccessPolicy(paranetId)
            );
        }

        for (uint256 i; i < minerAddresses.length; ) {
            if (!pkmr.knowledgeMinerExists(minerAddresses[i])) {
                pkmr.registerKnowledgeMiner(minerAddresses[i]);
            }

            if (pr.isKnowledgeMinerRegistered(paranetId, minerAddresses[i])) {
                revert ParanetLib.ParanetPermissionedMinerHasAlreadyBeenAdded(paranetId, minerAddresses[i]);
            }

            pr.addKnowledgeMiner(paranetId, minerAddresses[i]);

            emit ParanetPermissionedMinerAdded(
                paranetKCStorageContract,
                paranetKCTokenId,
                paranetKATokenId,
                minerAddresses[i]
            );

            unchecked {
                i++;
            }
        }
    }

    function removeParanetPermissionedMiners(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        address[] calldata minerAddresses
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getMinersAccessPolicy(paranetId) != MINERS_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = MINERS_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetMinersAccessPolicy(
                expectedAccessPolicies,
                pr.getMinersAccessPolicy(paranetId)
            );
        }

        for (uint256 i; i < minerAddresses.length; ) {
            if (!pr.isKnowledgeMinerRegistered(paranetId, minerAddresses[i])) {
                revert ParanetLib.ParanetPermissionedMinerDoesntExist(paranetId, minerAddresses[i]);
            }

            pr.removeKnowledgeMiner(paranetId, minerAddresses[i]);

            emit ParanetPermissionedMinerRemoved(
                paranetKCStorageContract,
                paranetKCTokenId,
                paranetKATokenId,
                minerAddresses[i]
            );

            unchecked {
                i++;
            }
        }
    }

    function requestParanetPermissionedMinerAccess(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId
    ) external {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getMinersAccessPolicy(paranetId) != MINERS_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = MINERS_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetMinersAccessPolicy(
                expectedAccessPolicies,
                pr.getMinersAccessPolicy(paranetId)
            );
        }

        ParanetLib.ParanetKnowledgeMinerAccessRequest[] memory paranetKnowledgeMinersAccessRequests = pr
            .getKnowledgeMinerAccessRequests(paranetId, msg.sender);

        if (
            paranetKnowledgeMinersAccessRequests.length > 0 &&
            paranetKnowledgeMinersAccessRequests[paranetKnowledgeMinersAccessRequests.length - 1].status ==
            ParanetLib.RequestStatus.PENDING
        ) {
            revert ParanetLib.ParanetPermissionedMinerAccessRequestInvalidStatus(
                paranetId,
                msg.sender,
                paranetKnowledgeMinersAccessRequests[paranetKnowledgeMinersAccessRequests.length - 1].status
            );
        }

        pr.addKnowledgeMinerAccessRequest(paranetId, msg.sender, ParanetLib.RequestStatus.PENDING);

        emit ParanetPermissionedMinerAccessRequestCreated(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            msg.sender
        );
    }

    function approvePermissionedMiner(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        address minerAddress
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getMinersAccessPolicy(paranetId) != MINERS_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = MINERS_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetMinersAccessPolicy(
                expectedAccessPolicies,
                pr.getMinersAccessPolicy(paranetId)
            );
        }

        ParanetLib.ParanetKnowledgeMinerAccessRequest[] memory paranetKnowledgeMinersAccessRequests = pr
            .getKnowledgeMinerAccessRequests(paranetId, minerAddress);

        if (paranetKnowledgeMinersAccessRequests.length == 0) {
            revert ParanetLib.ParanetPermissionedMinerAccessRequestDoesntExist(paranetId, minerAddress);
        } else if (
            paranetKnowledgeMinersAccessRequests[paranetKnowledgeMinersAccessRequests.length - 1].status !=
            ParanetLib.RequestStatus.PENDING
        ) {
            revert ParanetLib.ParanetPermissionedMinerAccessRequestInvalidStatus(
                paranetId,
                minerAddress,
                paranetKnowledgeMinersAccessRequests[paranetKnowledgeMinersAccessRequests.length - 1].status
            );
        }

        pr.updateKnowledgeMinerAccessRequestStatus(
            paranetId,
            minerAddress,
            paranetKnowledgeMinersAccessRequests.length - 1,
            ParanetLib.RequestStatus.APPROVED
        );
        pr.addKnowledgeMiner(paranetId, minerAddress);

        emit ParanetPermissionedMinerAccessRequestAccepted(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            minerAddress
        );
        emit ParanetPermissionedMinerAdded(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId, minerAddress);
    }

    function rejectPermissionedMiner(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId,
        address minerAddress
    ) external onlyKnowledgeAssetOwner(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId);

        _checkParanetExists(paranetId);

        if (pr.getMinersAccessPolicy(paranetId) != MINERS_ACCESS_POLICY_PERMISSIONED) {
            uint8[] memory expectedAccessPolicies = new uint8[](1);
            expectedAccessPolicies[0] = MINERS_ACCESS_POLICY_PERMISSIONED;

            revert ParanetLib.InvalidParanetMinersAccessPolicy(
                expectedAccessPolicies,
                pr.getMinersAccessPolicy(paranetId)
            );
        }

        ParanetLib.ParanetKnowledgeMinerAccessRequest[] memory paranetKnowledgeMinerAccessRequests = pr
            .getKnowledgeMinerAccessRequests(paranetId, minerAddress);

        if (paranetKnowledgeMinerAccessRequests.length == 0) {
            revert ParanetLib.ParanetPermissionedMinerAccessRequestDoesntExist(paranetId, minerAddress);
        } else if (
            paranetKnowledgeMinerAccessRequests[paranetKnowledgeMinerAccessRequests.length - 1].status !=
            ParanetLib.RequestStatus.PENDING
        ) {
            revert ParanetLib.ParanetPermissionedMinerAccessRequestInvalidStatus(
                paranetId,
                minerAddress,
                paranetKnowledgeMinerAccessRequests[paranetKnowledgeMinerAccessRequests.length - 1].status
            );
        }

        pr.updateKnowledgeMinerAccessRequestStatus(
            paranetId,
            minerAddress,
            paranetKnowledgeMinerAccessRequests.length - 1,
            ParanetLib.RequestStatus.REJECTED
        );

        emit ParanetPermissionedMinerAccessRequestRejected(
            paranetKCStorageContract,
            paranetKCTokenId,
            paranetKATokenId,
            minerAddress
        );
    }

    function getKnowledgeCollectionLocatorsWithPagination(
        bytes32 paranetId,
        uint256 offset,
        uint256 limit
    ) external view returns (ParanetLib.UniversalAssetCollectionLocator[] memory) {
        ParanetsRegistry pr = paranetsRegistry;
        bytes32[] memory knowledgeCollections = pr.getKnowledgeCollectionsWithPagination(paranetId, offset, limit);

        ParanetKnowledgeCollectionsRegistry pkcr = paranetKnowledgeCollectionsRegistry;

        return pkcr.getKnowledgeCollectionLocators(knowledgeCollections);
    }

    // function mintKnowledgeCollection(
    //     address paranetKCStorageContract,
    //     uint256 paranetKCTokenId,
    //     ContentCollectionStructs.CollectionInputArgs calldata knowledgeCollectionArgs
    // ) external returns (uint256) {
    //     ParanetsRegistry pr = paranetsRegistry;
    //     bytes32 paranetId = keccak256(abi.encodePacked(paranetKCStorageContract, paranetKCTokenId));

    //     // Check if Paranet exists
    //     // If not: Throw an error
    //     if (!pr.paranetExists(paranetId)) {
    //         revert ParanetLib.ParanetDoesntExist(paranetKCStorageContract, paranetKCTokenId);
    //     }

    //     ParanetLib.MinersAccessPolicy minersAccessPolicy = pr.getMinersAccessPolicy(paranetId);

    //     // Check if paranet is permissioned and if knowledge miner is whitelisted
    //     if (
    //         minersAccessPolicy == ParanetLib.MinersAccessPolicy.permissioned &&
    //         !pr.isKnowledgeMinerRegistered(paranetId, msg.sender)
    //     ) {
    //         revert ParanetLib.ParanetPermissionedMinerDoesntExist(paranetId, msg.sender);
    //     } else if (minersAccessPolicy == ParanetLib.MinersAccessPolicy.OPEN) {
    //         // Check if Knowledge Miner has profile
    //         // If not: Create a profile
    //         if (!paranetKnowledgeMinersRegistry.knowledgeMinerExists(msg.sender)) {
    //             paranetKnowledgeMinersRegistry.registerKnowledgeMiner(msg.sender);
    //         }

    //         // Check if Knowledge Miner is registered on paranet
    //         if (!pr.isKnowledgeMinerRegistered(paranetId, msg.sender)) {
    //             pr.addKnowledgeMiner(paranetId, msg.sender);
    //         }
    //     }

    //     // Mint Knowledge Collection
    //     uint256 knowledgeCollectionTokenId = contentCollection.createCollectionFromContract(
    //         msg.sender,
    //         knowledgeCollectionArgs
    //     );

    //     _updateSubmittedKnowledgeCollectionMetadata(
    //         paranetKCStorageContract,
    //         paranetKCTokenId,
    //         address(contentCollectionStorage),
    //         knowledgeCollectionTokenId,
    //         knowledgeCollectionArgs.tokenAmount
    //     );

    //     emit KnowledgeCollectionSubmittedToParanet(
    //         paranetKCStorageContract,
    //         paranetKCTokenId,
    //         address(contentCollectionStorage),
    //         knowledgeCollectionTokenId
    //     );

    //     return knowledgeCollectionTokenId;
    // }

    // If asset has been updated there should be logic to update paranet kc states metadata with info about previouse state if posible

    function submitKnowledgeCollection(
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId,
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId
    ) external onlyKnowledgeCollectionOwner(knowledgeCollectionStorageContract, knowledgeCollectionTokenId) {
        ParanetsRegistry pr = paranetsRegistry;
        bytes32 paranetId = _getParanetId(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId
        );

        _validateParanetAndKnowledgeCollection(
            paranetId,
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId
        );
        KnowledgeCollectionStorage kcs = KnowledgeCollectionStorage(knowledgeCollectionStorageContract);
        uint256 currentEpoch = chronos.getCurrentEpoch();
        uint40 kcStartEpoch = kcs.getStartEpoch(knowledgeCollectionTokenId);

        if (!(kcStartEpoch == currentEpoch || kcStartEpoch - 1 == currentEpoch)) {
            revert ParanetLib.KnowledgeCollectionNotInFirstEpoch(
                knowledgeCollectionStorageContract,
                knowledgeCollectionTokenId
            );
        }

        _updateKnowledgeMinerMetadata(paranetId);

        require(
            pr.getKnowledgeCollectionsSubmissionPolicy(paranetId) != KNOWLEDGE_COLLECTIONS_SUBMISSION_POLICY_STAGING,
            "Staging policy denied"
        );

        // Update KnowledgeMiner metadata
        _updateSubmittedKnowledgeCollectionMetadata(
            paranetId,
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId,
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId
        );
    }

    function stageKnowledgeCollection(
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId,
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId
    ) external onlyKnowledgeCollectionOwner(knowledgeCollectionStorageContract, knowledgeCollectionTokenId) {
        ParanetsRegistry pr = paranetsRegistry;

        bytes32 paranetId = _getParanetId(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId
        );

        _validateParanetAndKnowledgeCollection(
            paranetId,
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId
        );

        if (pr.getMinersAccessPolicy(paranetId) == MINERS_ACCESS_POLICY_PERMISSIONED) {
            require(pr.isKnowledgeMinerRegistered(paranetId, msg.sender), "Knowledge miner is not registered");
        }

        uint8 knowledgeCollectionsSubmissionPolicy = pr.getKnowledgeCollectionsSubmissionPolicy(paranetId);

        require(
            knowledgeCollectionsSubmissionPolicy == KNOWLEDGE_COLLECTIONS_SUBMISSION_POLICY_STAGING,
            "Paranet does not allow staging of knowledge collections"
        );

        KnowledgeCollectionStorage kcs = KnowledgeCollectionStorage(knowledgeCollectionStorageContract);
        uint256 currentEpoch = chronos.getCurrentEpoch();
        uint40 kcStartEpoch = kcs.getStartEpoch(knowledgeCollectionTokenId);

        if (!(kcStartEpoch == currentEpoch || kcStartEpoch - 1 == currentEpoch)) {
            revert ParanetLib.KnowledgeCollectionNotInFirstEpoch(
                knowledgeCollectionStorageContract,
                knowledgeCollectionTokenId
            );
        }

        bytes32 knowledgeCollectionId = keccak256(
            abi.encodePacked(knowledgeCollectionStorageContract, knowledgeCollectionTokenId)
        );
        ParanetStagingRegistry pss = paranetStagingRegistry;
        require(
            !pss.isKnowledgeCollectionStaged(paranetId, knowledgeCollectionId),
            "Knowledge collection is already staged"
        );
        pss.stageKnowledgeCollection(paranetId, knowledgeCollectionId, msg.sender);
    }

    function _validateParanetAndKnowledgeCollection(
        bytes32 paranetId,
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId
    ) internal view {
        _checkParanetExists(paranetId);

        ParanetKnowledgeCollectionsRegistry pkcr = paranetKnowledgeCollectionsRegistry;
        if (
            pkcr.isParanetKnowledgeCollection(
                keccak256(abi.encodePacked(knowledgeCollectionStorageContract, knowledgeCollectionTokenId))
            )
        ) {
            revert ParanetLib.KnowledgeCollectionIsAPartOfOtherParanet(
                knowledgeCollectionStorageContract,
                knowledgeCollectionTokenId,
                pkcr.getParanetId(
                    keccak256(abi.encodePacked(knowledgeCollectionStorageContract, knowledgeCollectionTokenId))
                )
            );
        }
    }

    function addCurator(
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId,
        address curator
    )
        external
        onlyKnowledgeAssetOwner(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId
        )
    {
        bytes32 paranetId = _getParanetId(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId
        );

        ParanetsRegistry pr = paranetsRegistry;
        _checkParanetExists(paranetId);

        uint8 knowledgeCollectionsSubmissionPolicy = pr.getKnowledgeCollectionsSubmissionPolicy(paranetId);
        require(
            knowledgeCollectionsSubmissionPolicy == KNOWLEDGE_COLLECTIONS_SUBMISSION_POLICY_STAGING,
            "Paranet does not allow adding curators"
        );
        ParanetStagingRegistry pss = paranetStagingRegistry;
        require(!pss.isCurator(paranetId, curator), "Existing curator");

        pss.addCurator(paranetId, curator);
    }

    function removeCurator(
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId,
        address curator
    )
        external
        onlyKnowledgeAssetOwner(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId
        )
    {
        bytes32 paranetId = _getParanetId(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId
        );
        ParanetsRegistry pr = paranetsRegistry;
        _checkParanetExists(paranetId);

        uint8 knowledgeCollectionsSubmissionPolicy = pr.getKnowledgeCollectionsSubmissionPolicy(paranetId);
        require(
            knowledgeCollectionsSubmissionPolicy == KNOWLEDGE_COLLECTIONS_SUBMISSION_POLICY_STAGING,
            "Paranet does not allow adding curators"
        );

        ParanetStagingRegistry pss = paranetStagingRegistry;
        require(pss.isCurator(paranetId, curator), "Address not a curator");
        pss.removeCurator(paranetId, curator);
    }

    function reviewKnowledgeCollection(
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId,
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId,
        bool accepted
    ) external onlyCurator(paranetKCStorageContract, paranetKnowledgeCollectionTokenId, paranetKnowledgeAssetTokenId) {
        bytes32 paranetId = _getParanetId(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId
        );
        bytes32 knowledgeCollectionId = keccak256(
            abi.encodePacked(knowledgeCollectionStorageContract, knowledgeCollectionTokenId)
        );

        _validateParanetAndKnowledgeCollection(
            paranetId,
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId
        );

        ParanetStagingRegistry pss = paranetStagingRegistry;
        require(pss.isKnowledgeCollectionStaged(paranetId, knowledgeCollectionId), "Knowledge collection not staged");
        pss.reviewKnowledgeCollection(paranetId, knowledgeCollectionId, accepted);

        if (accepted) {
            _updateKnowledgeMinerMetadata(paranetId);

            // Update KnowledgeMiner metadata
            _updateSubmittedKnowledgeCollectionMetadata(
                paranetId,
                paranetKCStorageContract,
                paranetKnowledgeCollectionTokenId,
                paranetKnowledgeAssetTokenId,
                knowledgeCollectionStorageContract,
                knowledgeCollectionTokenId
            );
        }
    }

    function _updateKnowledgeMinerMetadata(bytes32 paranetId) internal {
        ParanetKnowledgeMinersRegistry pkmr = paranetKnowledgeMinersRegistry;
        ParanetsRegistry pr = paranetsRegistry;
        uint8 minersAccessPolicy = pr.getMinersAccessPolicy(paranetId);
        // Check if paranet is permissioned and if knowledge miner is whitelisted
        if (minersAccessPolicy == MINERS_ACCESS_POLICY_PERMISSIONED) {
            require(pr.isKnowledgeMinerRegistered(paranetId, msg.sender), "Miner not registered");
            // Should this be done in both cases why would OPEN have separeted logic ???
        } else if (minersAccessPolicy == MINERS_ACCESS_POLICY_OPEN) {
            // Check if Knowledge Miner has profile
            // If not: Create a profile
            if (!pkmr.knowledgeMinerExists(msg.sender)) {
                pkmr.registerKnowledgeMiner(msg.sender);
            }

            // Check if Knowledge Miner is registered on paranet
            if (!pr.isKnowledgeMinerRegistered(paranetId, msg.sender)) {
                pr.addKnowledgeMiner(paranetId, msg.sender);
            }
        }
    }

    // function processUpdatedKnowledgeCollectionStatesMetadata(
    //     address paranetKCStorageContract,
    //     uint256 paranetKCTokenId,
    //     uint256 start,
    //     uint256 end
    // ) external {
    //     bytes32 paranetId = keccak256(abi.encodePacked(paranetKCStorageContract, paranetKCTokenId));

    //     _processUpdatedKnowledgeCollectionStatesMetadata(
    //         paranetId,
    //         paranetKnowledgeMinersRegistry.getUpdatingKnowledgeCollectionStates(msg.sender, paranetId, start, end)
    //     );
    // }

    function _updateSubmittedKnowledgeCollectionMetadata(
        bytes32 paranetId,
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId,
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId
    ) internal {
        KnowledgeCollectionStorage kcs = KnowledgeCollectionStorage(knowledgeCollectionStorageContract);

        ParanetsRegistry pr = paranetsRegistry;
        ParanetKnowledgeMinersRegistry pkmr = paranetKnowledgeMinersRegistry;

        uint96 remainingTokenAmount = kcs.getTokenAmount(knowledgeCollectionTokenId);
        KnowledgeCollectionLib.MerkleRoot[] memory merkleRoots = kcs.getMerkleRoots(knowledgeCollectionTokenId);
        bytes32 knowledgeCollectionId = keccak256(
            abi.encodePacked(knowledgeCollectionStorageContract, knowledgeCollectionTokenId)
        );

        // Add Knowledge Collection to the KnowledgeCollectionsRegistry
        paranetKnowledgeCollectionsRegistry.addKnowledgeCollection(
            paranetId,
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId,
            msg.sender
        );

        // Add Knowledge Collection Metadata to the ParanetsRegistry
        pr.addKnowledgeCollecton(paranetId, knowledgeCollectionId);
        pr.addCumulativeKnowledgeValue(paranetId, remainingTokenAmount);

        // Add Knowledge Collection Metadata to the KnowledgeMinersRegistry
        for (uint256 i = 0; i < merkleRoots.length - 1; ) {
            pkmr.addUpdatingKnowledgeCollectionState(
                msg.sender,
                paranetId,
                knowledgeCollectionStorageContract,
                knowledgeCollectionTokenId,
                merkleRoots[i].merkleRoot,
                0
            );

            unchecked {
                i++;
            }
        }
        pkmr.addUpdatingKnowledgeCollectionState(
            msg.sender,
            paranetId,
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId,
            merkleRoots[merkleRoots.length - 1].merkleRoot,
            remainingTokenAmount
        );
        pkmr.addSubmittedKnowledgeCollection(msg.sender, paranetId, knowledgeCollectionId);
        pkmr.addCumulativeTracSpent(msg.sender, paranetId, remainingTokenAmount);
        pkmr.addUnrewardedTracSpent(msg.sender, paranetId, remainingTokenAmount);
        pkmr.incrementTotalSubmittedKnowledgeCollectionsCount(msg.sender);
        pkmr.addTotalTracSpent(msg.sender, remainingTokenAmount);

        emit KnowledgeCollectionSubmittedToParanet(
            paranetKCStorageContract,
            paranetKnowledgeCollectionTokenId,
            paranetKnowledgeAssetTokenId,
            knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId
        );
    }

    function _getParanetId(
        address paranetKCStorageContract,
        uint256 paranetKCTokenId,
        uint256 paranetKATokenId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(paranetKCStorageContract, paranetKCTokenId, paranetKATokenId));
    }

    function _checkParanetExists(bytes32 paranetId) internal view {
        require(paranetsRegistry.paranetExists(paranetId), "Paranet does not exist");
    }

    // function _processUpdatedKnowledgeCollectionStatesMetadata(
    //     bytes32 paranetId,
    //     ParanetLib.UpdatingKnowledgeCollectionState[] memory updatingKnowledgeCollectionStates
    // ) internal {
    //     ParanetKnowledgeMinersRegistry pkmr = paranetKnowledgeMinersRegistry;
    //     ParanetsRegistry pr = paranetsRegistry;
    //     ContentCollection ca = contentCollection;

    //     for (uint i; i < updatingKnowledgeCollectionStates.length; ) {
    //         _checkKnowledgeCollectionOwner(
    //             updatingKnowledgeCollectionStates[i].knowledgeCollectionStorageContract,
    //             updatingKnowledgeCollectionStates[i].tokenId
    //         );

    //         bool continueOuterLoop = false;

    //         bytes32[] memory assertionIds = ContentCollectionStorage(
    //             updatingKnowledgeCollectionStates[i].knowledgeCollectionStorageContract
    //         ).getAssertionIds(updatingKnowledgeCollectionStates[i].tokenId);

    //         for (uint j = assertionIds.length; j > 0; ) {
    //             if (assertionIds[j - 1] == updatingKnowledgeCollectionStates[i].assertionId) {
    //                 // Add Knowledge Collection Token Amount Metadata to the ParanetsRegistry
    //                 pr.addCumulativeKnowledgeValue(paranetId, updatingKnowledgeCollectionStates[i].updateTokenAmount);

    //                 // Add Knowledge Collection Token Amount Metadata to the KnowledgeMinersRegistry
    //                 pkmr.addCumulativeTracSpent(
    //                     msg.sender,
    //                     paranetId,
    //                     updatingKnowledgeCollectionStates[i].updateTokenAmount
    //                 );
    //                 pkmr.addUnrewardedTracSpent(
    //                     msg.sender,
    //                     paranetId,
    //                     updatingKnowledgeCollectionStates[i].updateTokenAmount
    //                 );
    //                 pkmr.addTotalTracSpent(msg.sender, updatingKnowledgeCollectionStates[i].updateTokenAmount);

    //                 pkmr.removeUpdatingKnowledgeCollectionState(
    //                     msg.sender,
    //                     paranetId,
    //                     keccak256(
    //                         abi.encodePacked(
    //                             updatingKnowledgeCollectionStates[i].knowledgeCollectionStorageContract,
    //                             updatingKnowledgeCollectionStates[i].tokenId,
    //                             updatingKnowledgeCollectionStates[i].assertionId
    //                         )
    //                     )
    //                 );

    //                 continueOuterLoop = true;
    //                 break;
    //             }

    //             unchecked {
    //                 j--;
    //             }
    //         }

    //         unchecked {
    //             i++;
    //         }

    //         if (continueOuterLoop) {
    //             continue;
    //         }

    //         try ca.cancelCollectionStateUpdateFromContract(updatingKnowledgeCollectionStates[i].tokenId) {
    //             pkmr.removeUpdatingKnowledgeCollectionState(
    //                 msg.sender,
    //                 paranetId,
    //                 keccak256(
    //                     abi.encodePacked(
    //                         updatingKnowledgeCollectionStates[i].knowledgeCollectionStorageContract,
    //                         updatingKnowledgeCollectionStates[i].tokenId,
    //                         updatingKnowledgeCollectionStates[i].assertionId
    //                     )
    //                 )
    //             );
    //             // solhint-disable-next-line no-empty-blocks
    //         } catch {}
    //     }
    // }

    function _checkKnowledgeAssetOwner(
        address knowledgeCollectionStorageContractAddress,
        uint256 knowledgeCollectionId,
        uint256 knowledgeAssetId
    ) internal virtual {
        require(hub.isAssetStorage(knowledgeCollectionStorageContractAddress), "Given address not KC Storage");

        KnowledgeCollectionStorage knowledgeCollectionStorage = KnowledgeCollectionStorage(
            knowledgeCollectionStorageContractAddress
        );

        uint256 startTokenId = (knowledgeCollectionId - 1) *
            knowledgeCollectionStorage.knowledgeCollectionMaxSize() +
            knowledgeAssetId;

        uint256 ownedCountInRange = knowledgeCollectionStorage.balanceOf(msg.sender, startTokenId, startTokenId + 1);
        require(ownedCountInRange == 1, "Caller not the owner of the KA");
    }

    function _checkKnowledgeCollectionOwner(
        address knowledgeCollectionStorageContractAddress,
        uint256 knowledgeCollectionId
    ) internal virtual {
        require(hub.isAssetStorage(knowledgeCollectionStorageContractAddress), "Given address not KC Storage");

        KnowledgeCollectionStorage knowledgeCollectionStorage = KnowledgeCollectionStorage(
            knowledgeCollectionStorageContractAddress
        );
        uint256 minted = knowledgeCollectionStorage.getMinted(knowledgeCollectionId);
        uint256 burnedCount = knowledgeCollectionStorage.getBurnedAmount(knowledgeCollectionId);
        uint256 activeCount = minted - burnedCount;
        require(activeCount != 0, "No KAs in Collection");

        uint256 startTokenId = (knowledgeCollectionId - 1) *
            knowledgeCollectionStorage.knowledgeCollectionMaxSize() +
            1; // _startTokenId()

        uint256 ownedCountInRange = knowledgeCollectionStorage.balanceOf(
            msg.sender,
            startTokenId,
            startTokenId + minted + burnedCount
        );

        require(ownedCountInRange == activeCount, "Caller not the owner of KC");
    }

    function _checkCurator(
        address paranetKCStorageContract,
        uint256 paranetKnowledgeCollectionTokenId,
        uint256 paranetKnowledgeAssetTokenId
    ) internal view {
        require(
            paranetStagingRegistry.isCurator(
                keccak256(
                    abi.encodePacked(
                        paranetKCStorageContract,
                        paranetKnowledgeCollectionTokenId,
                        paranetKnowledgeAssetTokenId
                    )
                ),
                msg.sender
            ),
            "Not authorized curator"
        );
    }
}
