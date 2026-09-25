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

import {Ownable2StepUpgradeable} from "./Ownable2StepUpgradeable.sol";
import {PausableStorage} from "./storage/PausableStorage.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title PausableUpgradeable
/// @notice Upgrade-safe version of Pausable functionality
/// @dev Upgrade-safe version of Pausable, extracted from local Pausable.sol
abstract contract PausableUpgradeable is Initializable, Ownable2StepUpgradeable {
    /// @dev Error thrown when operation is not allowed while paused
    error EnforcedPause();

    /// @dev Error thrown when operation requires pause but contract is not paused
    error ExpectedPause();

    /// @dev Error thrown when caller is not the pauser
    error NotPauser(address caller);

    /// @dev Error thrown when trying to set the same pauser
    error SamePauser(address addr);

    /// @dev Error thrown when trying to set zero address as pauser
    error PauserZeroAddress();

    /// @notice Emitted when the contract is paused
    /// @param account The account that paused the contract
    event Paused(address account);

    /// @notice Emitted when the contract is unpaused
    /// @param account The account that unpaused the contract
    event Unpaused(address account);

    /// @notice Emitted when the pauser is transferred
    /// @param previousPauser The previous pauser address
    /// @param newPauser The new pauser address
    event PauserTransferred(address indexed previousPauser, address indexed newPauser);

    /// @dev Modifier that requires the contract to not be paused
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /// @dev Modifier that requires the contract to be paused
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    /// @dev Modifier that requires the caller to be the pauser
    modifier onlyPauser() {
        if (_msgSender() != PausableStorage.layout().pauser) {
            revert NotPauser(_msgSender());
        }
        _;
    }

    /// @notice Used during initialization to set the first pauser
    /// @param initialPauser The initial pauser address
    function _initializePausable(address initialPauser) internal virtual onlyInitializing {
        PausableStorage.Layout storage $ = PausableStorage.layout();
        $.paused = false;
        $.pauser = initialPauser;
        emit PauserTransferred(address(0), initialPauser);
    }

    /// @notice Returns the current paused state
    /// @return True if the contract is paused, false otherwise
    function paused() public view virtual returns (bool) {
        return PausableStorage.layout().paused;
    }

    /// @notice Returns the current pauser address
    /// @return The address of the current pauser
    function pauser() public view virtual returns (address) {
        return PausableStorage.layout().pauser;
    }

    /// @notice Pauses the contract
    /// @dev Can only be called by the pauser
    function pause() external virtual onlyPauser whenNotPaused {
        PausableStorage.layout().paused = true;
        emit Paused(_msgSender());
    }

    /// @notice Unpauses the contract
    /// @dev Can only be called by the pauser
    function unpause() external virtual onlyPauser whenPaused {
        PausableStorage.layout().paused = false;
        emit Unpaused(_msgSender());
    }

    /// @notice Updates the pauser address
    /// @dev Only callable by the owner
    /// @param newPauser The new pauser address
    function updatePauser(address newPauser) external virtual onlyOwner {
        if (newPauser == address(0)) revert PauserZeroAddress();
        _updatePauser(newPauser);
    }

    /// @notice Removes the pauser (sets to zero address)
    /// @dev Only callable by the owner
    function removePauser() external virtual onlyOwner {
        _updatePauser(address(0));
    }

    /// @param newPauser The new pauser address
    function _updatePauser(address newPauser) internal virtual {
        PausableStorage.Layout storage $ = PausableStorage.layout();
        address oldPauser = $.pauser;
        if (newPauser == oldPauser) revert SamePauser(newPauser);
        $.pauser = newPauser;
        emit PauserTransferred(oldPauser, newPauser);
    }

    /// @dev Reverts if the contract is paused
    function _requireNotPaused() internal view virtual {
        if (paused()) revert EnforcedPause();
    }

    /// @dev Reverts if the contract is not paused
    function _requirePaused() internal view virtual {
        if (!paused()) revert ExpectedPause();
    }
}
