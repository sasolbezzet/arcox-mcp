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

/// @title PausableStorage
/// @notice Provides EIP-7201 compliant namespaced storage for PausableUpgradeable
/// @dev Defines the storage layout and access method for pause-related state
library PausableStorage {
    /// @dev Storage slot constant for PausableUpgradeable layout.
    /// EIP-7201: keccak256(abi.encode(uint256(keccak256(
    ///     "stablecoinkit.storage.PausableUpgradeable")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT = 0xdd810d536104af9c2fee312b5d29f4e49aa01735922dc97181ec68c6caa60000;

    /// @dev Layout struct for PausableUpgradeable
    /// @custom:storage-location erc7201:stablecoinkit.storage.PausableUpgradeable
    struct Layout {
        bool paused;
        address pauser;
    }

    /// @notice Returns the storage layout for PausableUpgradeable
    /// @return lo The storage layout struct located at the fixed storage slot
    function layout() internal pure returns (Layout storage lo) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            lo.slot := slot
        }
    }
}
