/*
 * Copyright 2026 Circle Internet Group, Inc. All rights reserved.
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
 * @title IERC3009Token
 * @notice Minimal interface for ERC-3009 receiveWithAuthorization
 * @dev USDC (FiatTokenV2_1+) implements this standard. The caller (msg.sender)
 *      must equal the `to` parameter for receiveWithAuthorization.
 */
interface IERC3009Token {
    /**
     * @notice Receive a transfer authorized by an offchain signature from the token holder
     * @param from Token holder authorizing the transfer
     * @param to Recipient of the transfer; must be the caller for receiveWithAuthorization
     * @param value Amount of tokens to transfer
     * @param validAfter Timestamp after which the authorization is valid
     * @param validBefore Timestamp before which the authorization is valid
     * @param nonce Unique authorization nonce; Adapter sponsored execution uses the execution bundle commitment
     * @param v ECDSA signature v value
     * @param r ECDSA signature r value
     * @param s ECDSA signature s value
     */
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
