/*
 * Copyright 2025 Circle Internet Group, Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IAdapter} from "./interfaces/IAdapter.sol";
import {IDaiLikePermit} from "./interfaces/IDaiLikePermit.sol";

/**
 * @title PermitHandler
 * @notice Abstract contract handling permit types (EIP-2612, DAI-like, and pre-approved)
 * @dev Inherit this contract to gain permit handling capabilities
 */
abstract contract PermitHandler {
    using SafeERC20 for IERC20;

    /// @dev Sentinel address representing the native token
    address private constant _NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // ============================================================
    // ERRORS
    // ============================================================

    error InsufficientAllowance();
    error UnsupportedPermitType();

    // ============================================================
    // INTERNAL INTERFACE
    // ============================================================

    /**
     * @notice Process an array of token inputs (permit + transfer combined)
     * @param tokenInputs Array of token inputs to execute
     * @dev Call this from your contract to handle all token inputs
     */
    function _handleTokenInputs(IAdapter.TokenInput[] calldata tokenInputs) internal {
        unchecked {
            for (uint256 i; i < tokenInputs.length; ++i) {
                _handleSingleTokenInput(tokenInputs[i]);
            }
        }
    }

    // ============================================================
    // INTERNAL TOKEN INPUT ROUTING
    // ============================================================

    /**
     * @dev Route a single token input to its appropriate handler
     * @param input Token input to execute (permit + transfer)
     */
    function _handleSingleTokenInput(IAdapter.TokenInput calldata input) private {
        if (input.permitType == IAdapter.PermitType.NONE) {
            _executeTransferOnly(input);
        } else if (input.permitType == IAdapter.PermitType.EIP2612) {
            _executeEIP2612PermitAndTransfer(input);
        } else if (input.permitType == IAdapter.PermitType.DAI_LIKE) {
            _executeDaiPermitAndTransfer(input);
        } else {
            revert UnsupportedPermitType();
        }
    }

    // ============================================================
    // TOKEN INPUT HANDLERS
    // ============================================================

    /**
     * @dev Execute transfer only (no permit - for pre-approved tokens)
     * @param input Token input containing transfer data
     * @dev Native token transfers happen via msg.value, not via this function
     * @dev Tokens are always transferred from msg.sender for security
     */
    function _executeTransferOnly(IAdapter.TokenInput calldata input) private {
        // Skip for no token, native token (handled via msg.value), or zero amount
        if (input.token == address(0) || input.token == _NATIVE_TOKEN || input.amount == 0) return;

        IERC20(input.token).safeTransferFrom(msg.sender, address(this), input.amount);
    }

    /**
     * @dev Execute EIP-2612 permit then transfer
     * @param input Token input containing EIP-2612 data
     */
    function _executeEIP2612PermitAndTransfer(IAdapter.TokenInput calldata input) private {
        (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) =
            abi.decode(input.permitCalldata, (uint256, uint256, uint8, bytes32, bytes32));

        try IERC20Permit(input.token).permit(msg.sender, address(this), value, deadline, v, r, s) {
            // solhint-disable-next-line no-empty-blocks
        } catch {
            // Permit may already be used, verify sufficient allowance
            uint256 allowance = IERC20(input.token).allowance(msg.sender, address(this));
            if (allowance < input.amount) revert InsufficientAllowance();
        }

        // Transfer tokens after permit from msg.sender
        IERC20(input.token).safeTransferFrom(msg.sender, address(this), input.amount);
    }

    /**
     * @dev Execute DAI-style permit then transfer
     * @param input Token input containing DAI-style permit data
     */
    function _executeDaiPermitAndTransfer(IAdapter.TokenInput calldata input) private {
        (uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s) =
            abi.decode(input.permitCalldata, (uint256, uint256, bool, uint8, bytes32, bytes32));

        try IDaiLikePermit(input.token).permit(msg.sender, address(this), nonce, expiry, allowed, v, r, s) {
            // solhint-disable-next-line no-empty-blocks
        } catch {
            // Permit may already be used, verify sufficient allowance
            uint256 allowance = IERC20(input.token).allowance(msg.sender, address(this));
            if (allowance < input.amount) revert InsufficientAllowance();
        }

        // Transfer tokens after permit from msg.sender
        IERC20(input.token).safeTransferFrom(msg.sender, address(this), input.amount);
    }
}
