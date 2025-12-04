// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AigcRoyaltiesFHE is SepoliaConfig {
    struct EncryptedContribution {
        uint256 contributionId;
        address contributor;
        euint32 styleWeight;
        euint32 dataWeight;
        euint32 royaltyShare;
        uint256 timestamp;
    }

    struct RoyaltyDistribution {
        uint256 distributionId;
        euint32 totalUsage;
        euint32[] contributorShares;
        uint256 timestamp;
    }

    uint256 public contributionCount;
    uint256 public distributionCount;
    mapping(uint256 => EncryptedContribution) public contributions;
    mapping(uint256 => RoyaltyDistribution) public distributions;
    mapping(address => uint256[]) public contributorRecords;
    mapping(address => bool) public authorizedModels;

    event ContributionRegistered(uint256 indexed contributionId, address indexed contributor, uint256 timestamp);
    event DistributionRequested(uint256 indexed distributionId);
    event DistributionCompleted(uint256 indexed distributionId, uint256 timestamp);

    modifier onlyAuthorized() {
        require(authorizedModels[msg.sender], "Unauthorized AI model");
        _;
    }

    constructor() {
        authorizedModels[msg.sender] = true;
    }

    function authorizeModel(address model) external onlyAuthorized {
        authorizedModels[model] = true;
    }

    function registerContribution(
        euint32 encryptedStyleWeight,
        euint32 encryptedDataWeight,
        euint32 encryptedRoyaltyShare
    ) external {
        contributionCount++;
        uint256 newId = contributionCount;

        contributions[newId] = EncryptedContribution({
            contributionId: newId,
            contributor: msg.sender,
            styleWeight: encryptedStyleWeight,
            dataWeight: encryptedDataWeight,
            royaltyShare: encryptedRoyaltyShare,
            timestamp: block.timestamp
        });

        contributorRecords[msg.sender].push(newId);
        emit ContributionRegistered(newId, msg.sender, block.timestamp);
    }

    function requestRoyaltyDistribution() external onlyAuthorized {
        distributionCount++;
        uint256 newId = distributionCount;

        bytes32[] memory ciphertexts = new bytes32[](contributionCount * 3);
        uint256 index = 0;
        
        for (uint256 i = 1; i <= contributionCount; i++) {
            ciphertexts[index++] = FHE.toBytes32(contributions[i].styleWeight);
            ciphertexts[index++] = FHE.toBytes32(contributions[i].dataWeight);
            ciphertexts[index++] = FHE.toBytes32(contributions[i].royaltyShare);
        }

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.calculateDistribution.selector);
        emit DistributionRequested(newId);
    }

    function calculateDistribution(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) external {
        FHE.checkSignatures(requestId, cleartexts, proof);

        euint32[] memory results = abi.decode(cleartexts, (euint32[]));
        euint32[] memory shares = new euint32[](contributionCount);
        
        for (uint256 i = 0; i < contributionCount; i++) {
            shares[i] = results[i];
        }

        distributions[requestId] = RoyaltyDistribution({
            distributionId: requestId,
            totalUsage: results[contributionCount],
            contributorShares: shares,
            timestamp: block.timestamp
        });

        emit DistributionCompleted(requestId, block.timestamp);
    }

    function getContributionDetails(uint256 contributionId) external view returns (
        euint32, euint32, euint32
    ) {
        EncryptedContribution storage contrib = contributions[contributionId];
        return (contrib.styleWeight, contrib.dataWeight, contrib.royaltyShare);
    }

    function getDistributionResult(uint256 distributionId) external view returns (
        euint32, euint32[] memory
    ) {
        RoyaltyDistribution storage dist = distributions[distributionId];
        return (dist.totalUsage, dist.contributorShares);
    }

    function getContributorRecords(address contributor) external view returns (
        uint256[] memory
    ) {
        return contributorRecords[contributor];
    }
}