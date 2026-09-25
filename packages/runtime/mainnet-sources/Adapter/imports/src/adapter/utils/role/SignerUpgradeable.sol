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

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ConfigurableUpgradeable} from "./ConfigurableUpgradeable.sol";
import {SignerStorage} from "./storage/SignerStorage.sol";

/// @title SignerUpgradeable
/// @notice Upgrade-safe helper providing configurable signer set with a max signer count (threshold)
/// @dev Must be wired via `initializeSigners` inside the inheriting contractʼs `initialize` function.
///      Access control is delegated to the ConfigurableUpgradeable configurator.
abstract contract SignerUpgradeable is Initializable, ConfigurableUpgradeable {
    /// @dev Error thrown when trying to add an invalid signer address
    error InvalidSigner();

    /// @dev Error thrown when trying to add a duplicate signer
    error DuplicateSigner(address addr);

    /// @dev Error thrown when trying to remove a non-existent signer
    error SignerDoesNotExist(address addr);

    /// @dev Error thrown when attempting to leave the system with zero signers
    error AtLeastOneSignerRequired();

    /// @dev Error thrown when attempting to set an invalid threshold
    error InvalidThreshold(uint256 threshold);

    /// @dev Error thrown when threshold is inconsistent with signer count
    error ThresholdExceedsSignerCount(uint256 threshold, uint256 signerCount);

    /// @notice Emitted when a signer is added
    /// @param signer The address of the added signer
    event SignerAdded(address indexed signer);

    /// @notice Emitted when a signer is removed
    /// @param signer The address of the removed signer
    event SignerRemoved(address indexed signer);

    /// @notice Emitted when the maximum allowed signer count is updated
    /// @param previousThreshold The previous maximum signer count
    /// @param newThreshold The new maximum signer count
    event SignerThresholdUpdated(uint256 previousThreshold, uint256 newThreshold);

    /// @notice Initializer to set the initial signer and threshold
    /// @dev Should be called during the inheriting contractʼs initialize flow
    /// @param initialSigner The first signer address (must be non-zero)
    /// @param initialThreshold Max number of signers allowed (must be >= 1)
    function _initializeSigners(address initialSigner, uint256 initialThreshold) internal virtual onlyInitializing {
        // Set threshold first so _addSignerInternal can enforce it
        _setThresholdInternal(initialThreshold);
        _addSignerInternal(initialSigner);
    }

    /// @notice Checks if an address is a registered signer
    /// @param addr The address to check
    /// @return True if the address is a registered signer, false otherwise
    function isSigner(address addr) public view virtual returns (bool) {
        return SignerStorage.layout().signers[addr];
    }

    /// @notice Returns the current max signer threshold
    /// @return The maximum number of signers allowed at any given time
    function signerThreshold() public view virtual returns (uint256) {
        return SignerStorage.layout().threshold;
    }

    /// @notice Returns the current number of configured signers
    /// @return The number of active signers
    function signerCount() public view virtual returns (uint256) {
        return SignerStorage.layout().signerCount;
    }

    /// @notice Adds a single signer address
    /// @dev Only callable by the configurator
    /// @param addr Address to add as signer
    function addSigner(address addr) external virtual onlyConfigurator {
        _addSignerInternal(addr);
    }

    /// @notice Removes a single signer address
    /// @dev Only callable by the configurator
    /// @param addr Address to remove
    function removeSigner(address addr) external virtual onlyConfigurator {
        SignerStorage.Layout storage $ = SignerStorage.layout();
        if (!$.signers[addr]) revert SignerDoesNotExist(addr);

        uint256 newCount = $.signerCount - 1;
        if (newCount == 0) {
            revert AtLeastOneSignerRequired();
        }

        delete $.signers[addr];
        $.signerCount = newCount;

        emit SignerRemoved(addr);
    }

    /// @notice Sets the maximum number of signers that can be registered at any given time
    /// @dev This is NOT a multi-sig threshold (required signatures), but a cap on the total
    ///      number of authorized signers. Only callable by the configurator.
    ///      Must be >= current signerCount and >= 1.
    /// @param newThreshold The new maximum signer count
    function setSignerThreshold(uint256 newThreshold) external virtual onlyConfigurator {
        _setThresholdInternal(newThreshold);
    }

    /// @dev Internal function to add a single signer
    /// @param addr Address to add as signer
    function _addSignerInternal(address addr) internal virtual {
        if (addr == address(0)) revert InvalidSigner();

        SignerStorage.Layout storage $ = SignerStorage.layout();
        if ($.signers[addr]) revert DuplicateSigner(addr);

        // Enforce signerCount + 1 <= threshold
        if ($.threshold != 0 && $.signerCount + 1 > $.threshold) {
            revert ThresholdExceedsSignerCount($.threshold, $.signerCount + 1);
        }

        $.signers[addr] = true;
        $.signerCount += 1;

        emit SignerAdded(addr);
    }

    /// @dev Internal function to set the signer threshold (max signer count)
    /// @param newThreshold The new threshold value
    function _setThresholdInternal(uint256 newThreshold) internal virtual {
        SignerStorage.Layout storage $ = SignerStorage.layout();

        if (newThreshold == 0) {
            revert InvalidThreshold(newThreshold);
        }
        if (newThreshold < $.signerCount) {
            revert ThresholdExceedsSignerCount(newThreshold, $.signerCount);
        }

        uint256 oldThreshold = $.threshold;
        $.threshold = newThreshold;

        emit SignerThresholdUpdated(oldThreshold, newThreshold);
    }
}
