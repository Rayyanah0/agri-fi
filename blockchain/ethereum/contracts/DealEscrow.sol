// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DealEscrow is Initializable, UUPSUpgradeable, AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");

    enum DealMode { Simple, Milestone, Dispute }
    enum DealStatus { Created, Funded, Disputed, Released, Refunded }

    struct Milestone {
        uint128 amount;
        bool released;
    }

    IERC20 public asset;
    address public buyer;
    address public seller;
    address public arbitrator;
    DealMode public mode;
    DealStatus public status;
    uint128 public totalAmount;
    uint128 public releasedAmount;
    uint64 public disputeDeadline;
    Milestone[] private milestones;
    mapping(bytes32 => bool) public disputeVotes;

    event Funded(address indexed buyer, uint256 amount);
    event MilestoneReleased(uint256 indexed milestoneId, uint256 amount);
    event DisputeOpened(address indexed opener, bytes32 reasonHash);
    event DisputeResolved(address indexed recipient, uint256 amount);
    event Released(address indexed recipient, uint256 amount);
    event Refunded(address indexed buyer, uint256 amount);

    error InvalidTerms();
    error Unauthorized();
    error InvalidStatus();
    error InvalidMilestone();

    constructor() { _disableInitializers(); }

    /// mode: 0 simple escrow, 1 milestone release, 2 arbitrated dispute escrow.
    function initialize(
        address admin,
        address buyer_,
        address seller_,
        address arbitrator_,
        IERC20 asset_,
        uint128 totalAmount_,
        uint64 disputeWindowSeconds,
        uint128[] calldata milestoneAmounts,
        DealMode mode_
    ) external initializer {
        if (
            admin == address(0) || buyer_ == address(0) || seller_ == address(0) ||
            address(asset_) == address(0) || totalAmount_ == 0 || buyer_ == seller_ ||
            (mode_ == DealMode.Dispute && arbitrator_ == address(0))
        ) revert InvalidTerms();

        if (mode_ == DealMode.Milestone) {
            uint256 sum;
            if (milestoneAmounts.length == 0 || milestoneAmounts.length > 64) revert InvalidTerms();
            for (uint256 i; i < milestoneAmounts.length; ++i) {
                if (milestoneAmounts[i] == 0) revert InvalidTerms();
                sum += milestoneAmounts[i];
                milestones.push(Milestone({amount: milestoneAmounts[i], released: false}));
            }
            if (sum != totalAmount_) revert InvalidTerms();
        } else if (milestoneAmounts.length != 0) {
            revert InvalidTerms();
        }

        __AccessControl_init();
        __ReentrancyGuard_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (arbitrator_ != address(0)) _grantRole(ARBITRATOR_ROLE, arbitrator_);
        asset = asset_;
        buyer = buyer_;
        seller = seller_;
        arbitrator = arbitrator_;
        totalAmount = totalAmount_;
        disputeDeadline = uint64(block.timestamp) + disputeWindowSeconds;
        mode = mode_;
        status = DealStatus.Created;
    }

    function fund() external nonReentrant {
        if (msg.sender != buyer) revert Unauthorized();
        if (status != DealStatus.Created) revert InvalidStatus();
        status = DealStatus.Funded;
        asset.safeTransferFrom(buyer, address(this), totalAmount);
        emit Funded(buyer, totalAmount);
    }

    function releaseSimple() external nonReentrant {
        if (mode != DealMode.Simple || msg.sender != buyer) revert Unauthorized();
        if (status != DealStatus.Funded) revert InvalidStatus();
        status = DealStatus.Released;
        releasedAmount = totalAmount;
        asset.safeTransfer(seller, totalAmount);
        emit Released(seller, totalAmount);
    }

    function releaseMilestone(uint256 milestoneId) external nonReentrant {
        if (mode != DealMode.Milestone || msg.sender != buyer) revert Unauthorized();
        if (status != DealStatus.Funded || milestoneId >= milestones.length) revert InvalidMilestone();
        Milestone storage milestone = milestones[milestoneId];
        if (milestone.released) revert InvalidMilestone();
        milestone.released = true;
        releasedAmount += milestone.amount;
        if (releasedAmount == totalAmount) status = DealStatus.Released;
        asset.safeTransfer(seller, milestone.amount);
        emit MilestoneReleased(milestoneId, milestone.amount);
    }

    function openDispute(bytes32 reasonHash) external {
        if (mode != DealMode.Dispute || (msg.sender != buyer && msg.sender != seller)) revert Unauthorized();
        if (status != DealStatus.Funded || reasonHash == bytes32(0)) revert InvalidStatus();
        status = DealStatus.Disputed;
        emit DisputeOpened(msg.sender, reasonHash);
    }

    function resolveDispute(address recipient, uint128 amount) external nonReentrant onlyRole(ARBITRATOR_ROLE) {
        if (mode != DealMode.Dispute || status != DealStatus.Disputed) revert InvalidStatus();
        if ((recipient != buyer && recipient != seller) || amount > totalAmount) revert InvalidTerms();
        status = DealStatus.Released;
        releasedAmount = amount;
        uint256 refundAmount = totalAmount - amount;
        if (amount != 0) asset.safeTransfer(recipient, amount);
        if (refundAmount != 0) asset.safeTransfer(buyer, refundAmount);
        emit DisputeResolved(recipient, amount);
        if (refundAmount != 0) emit Refunded(buyer, refundAmount);
    }

    function refundAfterTimeout() external nonReentrant {
        if (msg.sender != buyer) revert Unauthorized();
        if ((status != DealStatus.Funded && status != DealStatus.Disputed) || block.timestamp <= disputeDeadline) revert InvalidStatus();
        status = DealStatus.Refunded;
        asset.safeTransfer(buyer, totalAmount - releasedAmount);
        emit Refunded(buyer, totalAmount - releasedAmount);
    }

    function milestoneCount() external view returns (uint256) { return milestones.length; }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        if (milestoneId >= milestones.length) revert InvalidMilestone();
        return milestones[milestoneId];
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    uint256[44] private __gap;
}