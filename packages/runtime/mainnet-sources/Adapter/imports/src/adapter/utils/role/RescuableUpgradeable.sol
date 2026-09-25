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
import {RescuableStorage} from "./storage/RescuableStorage.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RescuableUpgradeable
/// @notice Upgrade-safe version of Rescuable functionality
/// @dev Must be initialised via {initializeRescuable} inside the inheriting contractʼs
///      `initialize` function
abstract contract RescuableUpgradeable is Initializable, Ownable2StepUpgradeable {
    using SafeERC20 for IERC20;

    /// @dev Constant address representing the native token (Ether)
    address private constant _NATIVE_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// @dev Error thrown when caller is not the rescuer
    error NotRescuer(address caller);

    /// @dev Error thrown when trying to set the same rescuer
    error SameRescuer(address addr);

    /// @dev Error thrown when trying to set zero address as rescuer
    error RescuerZeroAddress();

    /// @dev Error thrown when rescue destination is invalid
    error InvalidRescueToAddress();

    /// @dev Error thrown when rescue value is invalid
    error InvalidRescueValue();

    /// @notice Emitted when the rescuer is transferred
    /// @param previousRescuer The previous rescuer address
    /// @param newRescuer The new rescuer address
    event RescuerTransferred(address indexed previousRescuer, address indexed newRescuer);

    /// @notice Emitted when tokens are rescued
    /// @param token The token address (or native token address)
    /// @param sender The address that initiated the rescue
    /// @param to The destination address
    /// @param value The amount rescued
    event TokensRescued(address indexed token, address indexed sender, address indexed to, uint256 value);

    /// @dev Modifier that requires the caller to be the rescuer
    modifier onlyRescuer() {
        if (RescuableStorage.layout().rescuer != _msgSender()) {
            revert NotRescuer(_msgSender());
        }
        _;
    }

    /// @notice Sets the initial rescuer address
    /// @dev Must be called in initializer
    /// @param initialRescuer The initial rescuer address
    function _initializeRescuable(address initialRescuer) internal virtual onlyInitializing {
        RescuableStorage.layout().rescuer = initialRescuer;
        emit RescuerTransferred(address(0), initialRescuer);
    }

    /// @notice Returns the current rescuer address
    /// @return The address of the current rescuer
    function rescuer() public view virtual returns (address) {
        return RescuableStorage.layout().rescuer;
    }

    /// @notice Rescues native tokens (Ether) from the contract
    /// @dev Only callable by the rescuer
    /// @param to The destination address
    /// @param value The amount to rescue
    function rescueNative(address to, uint256 value) external virtual onlyRescuer {
        if (to == address(0)) revert InvalidRescueToAddress();
        if (value == 0) revert InvalidRescueValue();

        emit TokensRescued(_NATIVE_TOKEN_ADDRESS, msg.sender, to, value);

        // Low-level native transfer; required for compatibility with arbitrary recipients
        // slither-disable-next-line assembly
        assembly {
            if iszero(call(gas(), to, value, 0, 0, 0, 0)) {
                mstore(0x00, 0xb12d13eb) // `ETHTransferFailed()`.
                revert(0x1c, 0x04)
            }
        }
    }

    /// @notice Rescues ERC20 tokens from the contract
    /// @dev Only callable by the rescuer
    /// @param token The ERC20 token address
    /// @param to The destination address
    /// @param value The amount to rescue
    function rescueERC20(address token, address to, uint256 value) external virtual onlyRescuer {
        if (to == address(0)) revert InvalidRescueToAddress();
        if (value == 0) revert InvalidRescueValue();

        emit TokensRescued(token, msg.sender, to, value);

        IERC20(token).safeTransfer(to, value);
    }

    /// @notice Updates the rescuer address
    /// @dev Only callable by the owner
    /// @param newRescuer The new rescuer address
    function updateRescuer(address newRescuer) external virtual onlyOwner {
        if (newRescuer == address(0)) revert RescuerZeroAddress();
        _updateRescuer(newRescuer);
    }

    /// @notice Removes the rescuer (sets to zero address)
    /// @dev Only callable by the owner
    function removeRescuer() external virtual onlyOwner {
        _updateRescuer(address(0));
    }

    /// @dev Internal helper to update the rescuer
    /// @param newRescuer The new rescuer address
    function _updateRescuer(address newRescuer) internal virtual {
        RescuableStorage.Layout storage $ = RescuableStorage.layout();
        address oldRescuer = $.rescuer;
        if (newRescuer == oldRescuer) revert SameRescuer(newRescuer);
        $.rescuer = newRescuer;
        emit RescuerTransferred(oldRescuer, newRescuer);
    }
}
