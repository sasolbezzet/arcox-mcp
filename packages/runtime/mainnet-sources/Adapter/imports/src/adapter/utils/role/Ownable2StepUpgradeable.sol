/**
 * Copyright 2025 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
pragma solidity 0.8.28;

import {Ownable2StepUpgradeable as OZOwnable2StepUpgradeable} from
    "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title Ownable2StepUpgradeable
/// @notice Custom version extending OpenZeppelin's Ownable2StepUpgradeable
/// @dev Removes renounceOwnership, forbids transferOwnership(0), adds cancelTransferOwnership
abstract contract Ownable2StepUpgradeable is Initializable, OZOwnable2StepUpgradeable {
    /// @dev Error thrown when attempting to assign an invalid owner address (e.g. zero address)
    error InvalidOwner();

    /// @dev Error thrown when calling {renounceOwnership}, which is explicitly disabled in this implementation
    error RenounceOwnershipDisabled();

    /// @notice Initializes ownership with the specified owner
    /// @dev Must be called during contract initialization
    /// @param initialOwner The initial owner address
    function _initializeOwnership(address initialOwner) internal virtual onlyInitializing {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
    }

    /// @dev Override renounceOwnership to disable functionality
    function renounceOwnership() public pure override {
        revert RenounceOwnershipDisabled();
    }

    /// @dev Override transferOwnership to forbid zero address
    function transferOwnership(address newOwner) public virtual override onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        super.transferOwnership(newOwner);
    }

    /// @dev Cancel ownership transfer, idempotent
    function cancelTransferOwnership() public virtual onlyOwner {
        if (pendingOwner() == address(0)) {
            return;
        }
        super.transferOwnership(address(0));
    }
}
