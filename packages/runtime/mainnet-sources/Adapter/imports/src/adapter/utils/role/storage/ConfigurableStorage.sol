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

/// @title ConfigurableStorage
/// @notice Provides EIP-7201 compliant namespaced storage for ConfigurableUpgradeable
/// @dev Defines the storage layout and access method for configurator role
library ConfigurableStorage {
    /// @dev Storage slot constant for Configurable layout.
    /// EIP-7201: keccak256(abi.encode(uint256(keccak256(
    ///     "stablecoinkit.storage.ConfigurableUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT = 0xd55455b2187a4304672aa6082a1eb69f0bea3cf6896525322db0285a3a57c500;

    /// @dev Layout struct for ConfigurableUpgradeable
    /// @custom:storage-location erc7201:stablecoinkit.storage.ConfigurableUpgradeable
    struct Layout {
        address configurator;
    }

    /// @notice Returns the storage layout for ConfigurableUpgradeable
    /// @return lo The storage layout struct located at the fixed storage slot
    function layout() internal pure returns (Layout storage lo) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            lo.slot := slot
        }
    }
}
