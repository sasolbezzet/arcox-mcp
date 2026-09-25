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
 * @title IAdapter
 * @notice Interface for adapter contract with batched instruction execution.
 * @dev Token address conventions:
 *      - address(0): No token
 *      - NATIVE_TOKEN (0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE): Native token
 *      - Any other address: ERC20 token
 * @author StableCoinKit Team
 */
interface IAdapter {
    // ============================================================
    // STRUCTS - CORE
    // ============================================================

    /**
     * @notice Permit type discriminator for universal permit handling
     * @dev NONE: No permit needed (pre-approved or native)
     * @dev EIP2612: Standard ERC20 permit (approval only, needs transferFrom)
     * @dev DAI_LIKE: DAI-style permit with explicit nonce and boolean approval
     * @dev ERC3009_RECEIVE: ERC-3009 receiveWithAuthorization for sponsored gasless flows
     *      permitCalldata: abi.encode(from, validAfter, validBefore, nonce, v, r, s)
     */
    enum PermitType {
        NONE,
        EIP2612,
        DAI_LIKE,
        ERC3009_RECEIVE
    }

    /**
     * @notice Token input structure combining permit and transfer in a single operation
     * @param permitType Type of permit to execute (use NONE for pre-approved tokens)
     * @param token Token address to transfer
     * @param amount Amount to permit and transfer
     * @param permitCalldata ABI-encoded permit parameters based on permitType:
     *        - NONE: empty (0x) - just transferFrom pre-approved tokens
     *        - EIP2612: abi.encode(value, deadline, v, r, s) - permit then transferFrom
     *        - DAI_LIKE: abi.encode(nonce, expiry, allowed, v, r, s) - permit then transferFrom
     *        - ERC3009_RECEIVE: abi.encode(from, validAfter, validBefore, nonce, v, r, s)
     *          - sponsored-only flow for executeSponsored(); not handled by PermitHandler
     * @dev Each handler is responsible for both authorization (if needed) and token transfer
     * @dev For EIP2612, DAI_LIKE, and NONE, a transferFrom is executed after permit (or directly if NONE)
     */
    struct TokenInput {
        PermitType permitType;
        address token;
        uint256 amount;
        bytes permitCalldata;
    }

    /**
     * @notice Instruction with optional token approve and output validation
     * @param target Target contract address
     * @param data Calldata for the target
     * @param value Native to send
     * @param tokenIn Token to approve before execution (address(0) = none)
     * @param amountToApprove Amount to approve (0 = skip approval)
     * @param tokenOut Token to validate output (address(0) = none)
     * @param minTokenOut Minimum expected output (0 = no validation)
     *
     * @dev Execution flow:
     *      1. If tokenIn != address(0) && amountToApprove > 0: Approve tokenIn to target
     *      2. Execute instruction
     *      3. If minTokenOut > 0: Validate output >= minTokenOut
     */
    struct Instruction {
        address target;
        bytes data;
        uint256 value;
        address tokenIn;
        uint256 amountToApprove;
        address tokenOut;
        uint256 minTokenOut;
    }

    /**
     * @notice Token with its beneficiary for residual sweeping
     * @param token Token address to validate and sweep
     * @param beneficiary Address to receive residual tokens for this specific token
     */
    struct TokenRecipient {
        address token;
        address beneficiary;
    }

    /**
     * @notice Main execution parameters
     * @param instructions Array of instructions to execute
     * @param tokens Array of tokens with their respective beneficiaries for residual sweeping
     * @param execId Unique execution identifier for replay protection
     * @param deadline Execution deadline timestamp
     * @param metadata Arbitrary bytes for event emission and tracking
     */
    struct ExecutionParams {
        Instruction[] instructions;
        TokenRecipient[] tokens;
        uint256 execId;
        uint256 deadline;
        bytes metadata;
    }

    /**
     * @notice ERC-3009 authorization fields bound into sponsored execution signer authorization
     * @param from ERC-3009 authorizer and sponsored-token refund recipient
     * @param token ERC-3009 token address
     * @param amount Sponsored token amount authorized for receiveWithAuthorization
     * @param validAfter Earliest timestamp when the ERC-3009 authorization is valid
     * @param validBefore Latest timestamp when the ERC-3009 authorization is valid
     */
    struct SponsoredAuthorization {
        address from;
        address token;
        uint256 amount;
        uint256 validAfter;
        uint256 validBefore;
    }

    /**
     * @notice Signed sponsored execution parameters authorized by a registered Adapter signer
     * @param instructions Array of instructions to execute
     * @param tokens Array of tokens with their respective beneficiaries for residual sweeping
     * @param execId Unique execution identifier for replay protection
     * @param deadline Execution deadline timestamp
     * @param metadata Arbitrary bytes for event emission and tracking
     * @param sponsoredAuthorization ERC-3009 authorization fields bound to the sponsored execution
     * @dev executeSponsored keeps accepting ExecutionParams to preserve its external ABI; this struct
     *      documents the EIP-712 SponsoredExecutionParams payload signed by the Adapter signer.
     */
    struct SponsoredExecutionParams {
        Instruction[] instructions;
        TokenRecipient[] tokens;
        uint256 execId;
        uint256 deadline;
        bytes metadata;
        SponsoredAuthorization sponsoredAuthorization;
    }

    // ============================================================
    // EVENTS
    // ============================================================

    /**
     * @notice Emitted when instructions are successfully executed
     * @param sender Address that initiated the execution
     * @param execId Unique execution identifier
     * @param metadata Arbitrary metadata for tracking
     */
    event Executed(address indexed sender, uint256 indexed execId, bytes metadata);

    /**
     * @notice Emitted when residual tokens are swept to beneficiary
     * @param beneficiary Address receiving the tokens
     * @param token Token address
     * @param amount Amount swept
     */
    event ResidualSwept(address indexed beneficiary, address indexed token, uint256 amount);

    /**
     * @notice Emitted when the maximum instructions limit is updated
     * @param previousMaxInstructions The previous limit
     * @param newMaxInstructions The new limit
     */
    event MaxInstructionsUpdated(uint256 previousMaxInstructions, uint256 newMaxInstructions);

    /**
     * @notice Emitted when the maximum token inputs limit is updated
     * @param previousMaxTokenInputs The previous limit
     * @param newMaxTokenInputs The new limit
     */
    event MaxTokenInputsUpdated(uint256 previousMaxTokenInputs, uint256 newMaxTokenInputs);

    // ============================================================
    // ERRORS
    // ============================================================

    // Validation Errors
    // ------------------------------------------------------------
    error DeadlineExpired();
    error InvalidExecId();
    error ExecIdUsed();
    error InvalidSignature();
    error ZeroAddress();
    error Unauthorized();
    error EmptyInstructions();
    error TooManyInstructions();
    error TooManyTokenInputs();
    error InvalidInstruction(uint256 instructionIndex);
    error InvalidApprovalConfig(uint256 instructionIndex);
    error InvalidOutputConfig(uint256 instructionIndex);
    error TokenInNotTracked(uint256 instructionIndex, address token);
    error InvalidBeneficiary();
    error InvalidLimit();

    // Execution Errors
    // ------------------------------------------------------------
    error ExecutionFailed(uint256 instructionIndex);
    error InsufficientOutput(uint256 instructionIndex, address token, uint256 received, uint256 expected);
    error InsufficientNativeValue(uint256 required, uint256 provided);
    error NativeTransferFailed();
    error InsufficientFinalBalance(address token, uint256 finalBalance, uint256 requiredBalance);
    error InvalidBalanceState();

    // Sponsored Execution Errors
    // ------------------------------------------------------------
    error SingleSponsoredTokenInputRequired();
    error NonceBundleMismatch();
    error ERC3009Required();
    error ZeroSponsoredAmount();
    error InvalidSponsoredToken();
    error InvalidSponsoredAuthorizer();
    error InvalidERC3009PermitCalldataLength();
    error SponsoredTokenNotInParamsTokens();

    // ============================================================
    // FUNCTIONS - EXECUTION
    // ============================================================

    /**
     * @notice Execute batched instructions
     * @param params Execution parameters including instructions and tokens with beneficiaries
     * @param tokenInputs Array of token inputs combining permits and transfers
     * @param signature EIP-712 signature from authorized signer
     */
    function execute(ExecutionParams calldata params, TokenInput[] calldata tokenInputs, bytes calldata signature)
        external
        payable;

    /**
     * @notice Execute batched instructions via sponsored gasless execution with ERC-3009 authorization
     * @param params Execution parameters including instructions and tokens with beneficiaries
     * @param tokenInputs Array containing exactly one ERC3009_RECEIVE token input for MVP
     * @param signature EIP-712 SponsoredExecutionParams signature from a registered Adapter signer
     * @dev The ERC-3009 nonce must equal the sponsored execution hash, binding the user's
     *      authorization to the exact sponsored execution bundle and the ERC-3009
     *      from/token/amount/validity-window fields. The Adapter signer's signature
     *      authorizes SponsoredExecutionParams. Unused sponsored-token balance is
     *      refunded to `from`.
     */
    function executeSponsored(
        ExecutionParams calldata params,
        TokenInput[] calldata tokenInputs,
        bytes calldata signature
    ) external payable;

    // ============================================================
    // FUNCTIONS - VIEW
    // ============================================================

    /**
     * @notice Check if execution ID has been used or is unavailable
     * @dev Execution ID 0 is reserved and always returns true.
     * @param execId Execution ID to check
     * @return True if the execution ID has been consumed or is reserved
     */
    function isExecIdUsed(uint256 execId) external view returns (bool);
}
