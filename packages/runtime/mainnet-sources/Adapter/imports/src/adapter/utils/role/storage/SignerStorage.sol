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

/// @title SignerStorage
/// @notice Provides EIP-7201 compliant namespaced storage for SignerUpgradeable
/// @dev Defines the storage layout and access method for signer management
library SignerStorage {
    /// @dev Storage slot constant for SignerUpgradeable layout.
    ///      EIP-7201:
    ///      keccak256(
    ///          abi.encode(
    ///              uint256(keccak256("stablecoinkit.storage.SignerUpgradeable")) - 1
    ///          )
    ///      ) & ~bytes32(uint256(0xff))
    bytes32 internal constant STORAGE_SLOT = 0xf9d5be007e554e92d20b85237d48daf6617503c674d9b0528a11eef42e5bfa00;

    /// @dev Layout struct for SignerUpgradeable
    /// @custom:storage-location erc7201:stablecoinkit.storage.SignerUpgradeable
    struct Layout {
        mapping(address => bool) signers;
        uint256 signerCount;
        uint256 threshold;
    }

    /// @notice Returns the storage layout for SignerUpgradeable
    /// @return lo The storage layout struct located at the fixed storage slot
    function layout() internal pure returns (Layout storage lo) {
        bytes32 slot = STORAGE_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            lo.slot := slot
        }
    }
}
