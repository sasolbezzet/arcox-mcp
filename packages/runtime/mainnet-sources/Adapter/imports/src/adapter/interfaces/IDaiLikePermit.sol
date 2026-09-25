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

/**
 * @title IDaiLikePermit
 * @notice Interface for DAI-style permit (original permit implementation)
 * @dev Used by DAI, CHAI, and other MakerDAO tokens
 */
interface IDaiLikePermit {
    /**
     * @notice Permit approval with explicit nonce
     * @param holder Token holder address
     * @param spender Spender address
     * @param nonce Nonce for replay protection
     * @param expiry Permit expiration timestamp
     * @param allowed If true, approve unlimited; if false, revoke approval
     * @param v ECDSA signature parameter
     * @param r ECDSA signature parameter
     * @param s ECDSA signature parameter
     */
    function permit(
        address holder,
        address spender,
        uint256 nonce,
        uint256 expiry,
        bool allowed,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
