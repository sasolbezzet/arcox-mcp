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

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {ConfigurableUpgradeable} from "./utils/role/ConfigurableUpgradeable.sol";
import {Ownable2StepUpgradeable} from "./utils/role/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "./utils/role/PausableUpgradeable.sol";
import {RescuableUpgradeable} from "./utils/role/RescuableUpgradeable.sol";
import {SignerUpgradeable} from "./utils/role/SignerUpgradeable.sol";

import {IAdapter} from "./interfaces/IAdapter.sol";
import {IERC3009Token} from "./interfaces/IERC3009Token.sol";
import {PermitHandler} from "./PermitHandler.sol";

/**
 * @title Adapter
 * @notice Execute batched instructions with token approve and output validation
 * @dev Features:
 *      - Per-instruction token approvals and output validation
 *      - Permit system (EIP-2612, DAI-like, and ERC-3009 via executeSponsored)
 *      - Explicit residual token sweeping
 */
contract Adapter is
    Initializable,
    Ownable2StepUpgradeable,
    ConfigurableUpgradeable,
    PausableUpgradeable,
    RescuableUpgradeable,
    SignerUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    PermitHandler,
    IAdapter
{
    using SafeERC20 for IERC20;

    // ============================================================
    // CONSTANTS
    // ============================================================

    /// @notice Sentinel address representing the native token
    address public constant NATIVE_TOKEN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // EIP-712 Typehashes - Core Structs
    // ------------------------------------------------------------

    /// @notice EIP-712 typehash for Instruction
    bytes32 private constant _INSTRUCTION_TYPEHASH = keccak256(
        "Instruction(address target,bytes data,uint256 value,"
        "address tokenIn,uint256 amountToApprove,address tokenOut,uint256 minTokenOut)"
    );

    /// @notice EIP-712 typehash for TokenRecipient
    bytes32 private constant _TOKEN_RECIPIENT_TYPEHASH = keccak256("TokenRecipient(address token,address beneficiary)");

    /// @notice EIP-712 typehash for ExecutionParams
    bytes32 private constant _EXECUTION_PARAMS_TYPEHASH = keccak256(
        "ExecutionParams(" "Instruction[] instructions," "TokenRecipient[] tokens," "uint256 execId,"
        "uint256 deadline," "bytes metadata" ")" "Instruction(address target,bytes data,uint256 value,"
        "address tokenIn,uint256 amountToApprove,address tokenOut,uint256 minTokenOut)"
        "TokenRecipient(address token,address beneficiary)"
    );

    /// @notice EIP-712 typehash for the ERC-3009 fields bound into executeSponsored signer authorization
    bytes32 private constant _SPONSORED_AUTHORIZATION_TYPEHASH = keccak256(
        "SponsoredAuthorization(address from,address token,uint256 amount,uint256 validAfter,uint256 validBefore)"
    );

    /// @notice EIP-712 typehash for executeSponsored signer authorization
    bytes32 private constant _SPONSORED_EXECUTION_PARAMS_TYPEHASH = keccak256(
        "SponsoredExecutionParams(Instruction[] instructions,TokenRecipient[] tokens,uint256 execId,"
        "uint256 deadline,bytes metadata,SponsoredAuthorization sponsoredAuthorization)"
        "Instruction(address target,bytes data,uint256 value,"
        "address tokenIn,uint256 amountToApprove,address tokenOut,uint256 minTokenOut)"
        "SponsoredAuthorization(address from,address token,uint256 amount,uint256 validAfter,uint256 validBefore)"
        "TokenRecipient(address token,address beneficiary)"
    );

    /// @notice ABI-encoded length for ERC-3009 receiveWithAuthorization calldata (7 words * 32 bytes)
    uint256 private constant _ERC3009_RECEIVE_AUTHORIZATION_CALLDATA_LENGTH = 224;

    /// @notice Default maximum number of instructions allowed per execution
    uint256 private constant _DEFAULT_MAX_INSTRUCTIONS = 50;

    /// @notice Default maximum number of token inputs allowed per execution
    uint256 private constant _DEFAULT_MAX_TOKEN_INPUTS = 10;

    // ============================================================
    // TYPES
    // ============================================================

    /// @dev Memory-only decoded ERC-3009 receiveWithAuthorization payload for executeSponsored()
    struct ERC3009TokenReceiveAuthorization {
        address from;
        address token;
        uint256 amount;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // ============================================================
    // STATE VARIABLES
    // ============================================================

    // EIP-7201 Namespaced Storage
    // ------------------------------------------------------------

    /// @custom:storage-location erc7201:stablecoinkit.storage.Adapter
    struct AdapterStorage {
        /// @notice Mapping for tracking used execution IDs to prevent replay attacks
        mapping(uint256 execId => bool used) execIdUsed;
        /// @notice Maximum number of instructions allowed per execution
        uint256 maxInstructions;
        /// @notice Maximum number of token inputs (combined permits + transfers)
        uint256 maxTokenInputs;
    }

    // keccak256(abi.encode(uint256(keccak256("stablecoinkit.storage.Adapter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _ADAPTER_STORAGE_LOCATION =
        0xde64240c1c7b91212bbc9e8777c1adc2bce350ee4da294b03d97b971a1fed000;

    /**
     * @dev Returns the storage pointer for AdapterStorage
     */
    function _getAdapterStorage() private pure returns (AdapterStorage storage $) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            $.slot := _ADAPTER_STORAGE_LOCATION
        }
    }

    // ============================================================
    // INITIALIZER
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param owner_ Contract owner address (also set as initial configurator, pauser, and rescuer)
     * @param signer_ Initial authorized signer address for EIP-712 signatures
     * @param signerThreshold_ Maximum number of signers allowed
     * @dev Owner can update configurator, pauser, and rescuer after initialization
     */
    function initialize(address owner_, address signer_, uint256 signerThreshold_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        if (signer_ == address(0)) revert ZeroAddress();

        _initializeOwnership(owner_);
        _initializeConfigurable(owner_);
        _initializePausable(owner_);
        _initializeRescuable(owner_);
        _initializeSigners(signer_, signerThreshold_);

        // Set default protocol limits
        AdapterStorage storage $ = _getAdapterStorage();
        $.maxInstructions = _DEFAULT_MAX_INSTRUCTIONS;
        $.maxTokenInputs = _DEFAULT_MAX_TOKEN_INPUTS;
        emit MaxInstructionsUpdated(0, _DEFAULT_MAX_INSTRUCTIONS);
        emit MaxTokenInputsUpdated(0, _DEFAULT_MAX_TOKEN_INPUTS);

        __ReentrancyGuard_init();
        __EIP712_init("Adapter", "1");
    }

    // ============================================================
    // EXTERNAL FUNCTIONS - EXECUTION
    // ============================================================

    /**
     * @notice Execute batched instructions
     * @param params Execution parameters including instructions and tokens with beneficiaries (signed)
     * @param tokenInputs Array of token inputs combining permits and transfers
     * @param signature EIP-712 signature from authorized signer
     */
    function execute(ExecutionParams calldata params, TokenInput[] calldata tokenInputs, bytes calldata signature)
        external
        payable
        override
        whenNotPaused
        nonReentrant
    {
        _verifySignature(params, signature);
        _validateParams(params, tokenInputs);
        _validateTrackedTokenInputs(params.instructions, params.tokens);
        _validateNativeValueFunding(params.instructions);
        _consumeExecId(params.execId);

        uint256[] memory initialBalances = _snapshotBalances(params.tokens);

        _handleTokenInputs(tokenInputs);
        _executeInstructions(params.instructions);

        _validateAndSweepResiduals(params.tokens, initialBalances, address(0), address(0));
        emit Executed(msg.sender, params.execId, params.metadata);
    }

    /**
     * @notice Execute batched instructions via sponsored gasless execution with ERC-3009 authorization
     * @param params Execution parameters including instructions and tokens with beneficiaries
     * @param tokenInputs Array containing exactly one ERC3009_RECEIVE token input
     * @param signature EIP-712 SponsoredExecutionParams signature from a registered Adapter signer
     * @dev The ERC-3009 nonce must equal _hashSponsoredExecutionParams(params, sponsoredAuthorization),
     *      cryptographically binding the user's authorization to the exact sponsored execution bundle
     *      and the ERC-3009 from/token/amount/validity-window fields.
     *      Any unused balance for the sponsored token is refunded to `from`.
     */
    function executeSponsored(
        ExecutionParams calldata params,
        TokenInput[] calldata tokenInputs,
        bytes calldata signature
    ) external payable override whenNotPaused nonReentrant {
        _validateParams(params, tokenInputs);
        ERC3009TokenReceiveAuthorization memory tokenReceiveAuthorization =
            _validateAndDecodeSponsoredTokenInput(tokenInputs, params.tokens);
        bytes32 bundleCommitment =
            _hashSponsoredExecutionParams(params, _toSponsoredAuthorization(tokenReceiveAuthorization));
        if (tokenReceiveAuthorization.nonce != bundleCommitment) revert NonceBundleMismatch();
        _verifyStructHash(bundleCommitment, signature);
        _validateTrackedTokenInputs(params.instructions, params.tokens);
        _validateNativeValueFunding(params.instructions);
        _consumeExecId(params.execId);

        uint256[] memory initialBalances = _snapshotBalances(params.tokens);

        _receiveSponsoredTokens(tokenReceiveAuthorization);
        _executeInstructions(params.instructions);

        _validateAndSweepResiduals(
            params.tokens, initialBalances, tokenReceiveAuthorization.token, tokenReceiveAuthorization.from
        );
        emit Executed(msg.sender, params.execId, params.metadata);
    }

    // ============================================================
    // EXTERNAL/PUBLIC VIEW FUNCTIONS
    // ============================================================

    /**
     * @notice Check if execution ID has been used or is unavailable
     * @dev Execution ID 0 is reserved and always returns true.
     * @param execId Execution ID to check
     * @return True if the execution ID has been used or is reserved
     */
    function isExecIdUsed(uint256 execId) external view override returns (bool) {
        if (execId == 0) return true;
        AdapterStorage storage $ = _getAdapterStorage();
        return $.execIdUsed[execId];
    }

    /**
     * @notice Get EIP-712 domain separator
     * @return The current EIP-712 domain separator
     */
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Get the maximum number of instructions allowed per execution
     * @return The current maximum instructions limit
     */
    function maxInstructions() external view returns (uint256) {
        return _getAdapterStorage().maxInstructions;
    }

    /**
     * @notice Get the maximum number of token inputs allowed per execution
     * @return The current maximum token inputs limit
     */
    function maxTokenInputs() external view returns (uint256) {
        return _getAdapterStorage().maxTokenInputs;
    }

    /**
     * @notice Update the maximum number of instructions allowed per execution
     * @dev Only callable by the configurator
     * @param newMaxInstructions The new maximum instructions limit
     */
    function updateMaxInstructions(uint256 newMaxInstructions) external onlyConfigurator {
        if (newMaxInstructions == 0) revert InvalidLimit();
        AdapterStorage storage $ = _getAdapterStorage();
        uint256 previousMaxInstructions = $.maxInstructions;
        $.maxInstructions = newMaxInstructions;
        emit MaxInstructionsUpdated(previousMaxInstructions, newMaxInstructions);
    }

    /**
     * @notice Update the maximum number of token inputs allowed per execution
     * @dev Only callable by the configurator
     * @param newMaxTokenInputs The new maximum token inputs limit
     */
    function updateMaxTokenInputs(uint256 newMaxTokenInputs) external onlyConfigurator {
        if (newMaxTokenInputs == 0) revert InvalidLimit();
        AdapterStorage storage $ = _getAdapterStorage();
        uint256 previousMaxTokenInputs = $.maxTokenInputs;
        $.maxTokenInputs = newMaxTokenInputs;
        emit MaxTokenInputsUpdated(previousMaxTokenInputs, newMaxTokenInputs);
    }

    // ============================================================
    // INTERNAL FUNCTIONS - VALIDATION & VERIFICATION
    // ============================================================

    /**
     * @dev Validate execution parameters
     * @param params Execution parameters to validate
     * @param tokenInputs Array of token inputs to validate
     */
    function _validateParams(ExecutionParams calldata params, TokenInput[] calldata tokenInputs) private view {
        // solhint-disable-next-line not-rely-on-time
        if (block.timestamp > params.deadline) revert DeadlineExpired();

        AdapterStorage storage $ = _getAdapterStorage();
        uint256 instructionsLen = params.instructions.length;
        uint256 tokenInputsLen = tokenInputs.length;
        uint256 tokensLen = params.tokens.length;

        if (instructionsLen == 0) revert EmptyInstructions();
        if (instructionsLen > $.maxInstructions) revert TooManyInstructions();
        if (tokenInputsLen > $.maxTokenInputs) revert TooManyTokenInputs();

        // Validate each token's beneficiary
        for (uint256 i; i < tokensLen; ++i) {
            address beneficiary = params.tokens[i].beneficiary;
            if (beneficiary == address(0) || beneficiary == address(this)) {
                revert InvalidBeneficiary();
            }
        }
    }

    /**
     * @notice Validate approved token inputs are tracked
     * @dev Approved ERC20 inputs must be tracked so balance protection can detect decreases.
     * @param instructions Array of instructions to validate
     * @param tokens Array of token recipients to check for tracked inputs
     */
    function _validateTrackedTokenInputs(Instruction[] calldata instructions, TokenRecipient[] calldata tokens)
        private
        pure
    {
        for (uint256 i; i < instructions.length; ++i) {
            address tokenIn = instructions[i].tokenIn;
            uint256 amountToApprove = instructions[i].amountToApprove;
            if (
                amountToApprove > 0 && tokenIn != address(0) && tokenIn != NATIVE_TOKEN
                    && !_isTokenTracked(tokens, tokenIn)
            ) {
                revert TokenInNotTracked(i, tokenIn);
            }
        }
    }

    /**
     * @notice Validate native value funding
     * @dev Validate caller supplied enough native value to fund all instruction calls
     * @param instructions Array of instructions to validate
     */
    function _validateNativeValueFunding(Instruction[] calldata instructions) private view {
        uint256 requiredNativeValue;
        for (uint256 i; i < instructions.length; ++i) {
            requiredNativeValue += instructions[i].value;
        }
        if (msg.value < requiredNativeValue) {
            revert InsufficientNativeValue(requiredNativeValue, msg.value);
        }
    }

    /**
     * @dev Mark execution ID as used
     * @param execId Execution ID to mark as used
     */
    function _consumeExecId(uint256 execId) private {
        if (execId == 0) revert InvalidExecId();
        AdapterStorage storage $ = _getAdapterStorage();
        if ($.execIdUsed[execId]) revert ExecIdUsed();
        $.execIdUsed[execId] = true;
    }

    // Signature Verification
    // ------------------------------------------------------------

    /**
     * @dev Verify EIP-712 signature for execute()
     * @param params Execution parameters to hash
     * @param signature Signature to verify against authorized signers
     */
    function _verifySignature(ExecutionParams calldata params, bytes calldata signature) private view {
        _verifyStructHash(_hashExecutionParams(params), signature);
    }

    /**
     * @dev Verify an EIP-712 signature against the Adapter's domain separator
     * @param structHash The EIP-712 struct hash to verify (e.g. _hashExecutionParams result)
     * @param signature Signature to verify against authorized signers
     */
    function _verifyStructHash(bytes32 structHash, bytes calldata signature) private view {
        bytes32 digest = _hashTypedDataV4(structHash);
        (address recoveredSigner, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, signature);
        if (error != ECDSA.RecoverError.NoError || !isSigner(recoveredSigner)) {
            revert InvalidSignature();
        }
    }

    // EIP-712 Hashing Helpers
    // ------------------------------------------------------------

    /**
     * @dev Hash ExecutionParams for EIP-712 signature
     * @param params Execution parameters to hash
     * @return Hash of the execution params struct
     */
    function _hashExecutionParams(ExecutionParams calldata params) private pure returns (bytes32) {
        return _hashExecutionParamsWithTypehash(params, _EXECUTION_PARAMS_TYPEHASH);
    }

    /**
     * @dev Hash SponsoredExecutionParams for EIP-712 signature
     * @param params Execution parameters to hash
     * @param sponsoredAuthorization Sponsored ERC-3009 authorization to hash with params
     * @return Hash of the sponsored execution params struct
     */
    function _hashSponsoredExecutionParams(
        ExecutionParams calldata params,
        IAdapter.SponsoredAuthorization memory sponsoredAuthorization
    ) private pure returns (bytes32) {
        bytes32[] memory instructionHashes = new bytes32[](params.instructions.length);
        for (uint256 i; i < params.instructions.length; ++i) {
            instructionHashes[i] = _hashInstruction(params.instructions[i]);
        }

        bytes32[] memory tokenHashes = new bytes32[](params.tokens.length);
        for (uint256 i; i < params.tokens.length; ++i) {
            tokenHashes[i] = _hashTokenRecipient(params.tokens[i]);
        }

        return keccak256(
            abi.encode(
                _SPONSORED_EXECUTION_PARAMS_TYPEHASH,
                keccak256(abi.encodePacked(instructionHashes)),
                keccak256(abi.encodePacked(tokenHashes)),
                params.execId,
                params.deadline,
                keccak256(params.metadata),
                _hashSponsoredAuthorization(sponsoredAuthorization)
            )
        );
    }

    /**
     * @dev Hash execution params with a caller-provided top-level typehash
     * @param params Execution parameters to hash
     * @param typeHash EIP-712 top-level typehash to use
     * @return Hash of the execution params struct under the provided typehash
     */
    function _hashExecutionParamsWithTypehash(ExecutionParams calldata params, bytes32 typeHash)
        private
        pure
        returns (bytes32)
    {
        bytes32[] memory instructionHashes = new bytes32[](params.instructions.length);
        for (uint256 i; i < params.instructions.length; ++i) {
            instructionHashes[i] = _hashInstruction(params.instructions[i]);
        }

        bytes32[] memory tokenHashes = new bytes32[](params.tokens.length);
        for (uint256 i; i < params.tokens.length; ++i) {
            tokenHashes[i] = _hashTokenRecipient(params.tokens[i]);
        }

        return keccak256(
            abi.encode(
                typeHash,
                keccak256(abi.encodePacked(instructionHashes)),
                keccak256(abi.encodePacked(tokenHashes)),
                params.execId,
                params.deadline,
                keccak256(params.metadata)
            )
        );
    }

    /**
     * @dev Hash TokenRecipient for EIP-712 signature
     * @param tokenRecipient Token recipient struct to hash
     * @return Hash of the token recipient struct
     */
    function _hashTokenRecipient(TokenRecipient calldata tokenRecipient) private pure returns (bytes32) {
        return keccak256(abi.encode(_TOKEN_RECIPIENT_TYPEHASH, tokenRecipient.token, tokenRecipient.beneficiary));
    }

    /**
     * @dev Hash Instruction for EIP-712 signature
     * @param instruction Instruction struct to hash
     * @return Hash of the instruction struct
     */
    function _hashInstruction(Instruction calldata instruction) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _INSTRUCTION_TYPEHASH,
                instruction.target,
                keccak256(instruction.data),
                instruction.value,
                instruction.tokenIn,
                instruction.amountToApprove,
                instruction.tokenOut,
                instruction.minTokenOut
            )
        );
    }

    /**
     * @dev Hash SponsoredAuthorization for EIP-712 signature
     * @param sponsoredAuthorization Sponsored ERC-3009 authorization to hash
     * @return Hash of the sponsored authorization struct
     */
    function _hashSponsoredAuthorization(IAdapter.SponsoredAuthorization memory sponsoredAuthorization)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                _SPONSORED_AUTHORIZATION_TYPEHASH,
                sponsoredAuthorization.from,
                sponsoredAuthorization.token,
                sponsoredAuthorization.amount,
                sponsoredAuthorization.validAfter,
                sponsoredAuthorization.validBefore
            )
        );
    }

    // ============================================================
    // INTERNAL FUNCTIONS - TOKEN MANAGEMENT
    // ============================================================

    /**
     * @dev Snapshot current balances for residual sweep comparison
     * @param tokens Array of token recipients to snapshot
     * @return Array of current balances for each token
     */
    function _snapshotBalances(TokenRecipient[] memory tokens) private view returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            balances[i] = _getBalance(tokens[i].token, true);
        }
        return balances;
    }

    /**
     * @dev Get balance of token (native token or ERC20)
     * @param token Token address (or native token sentinel address)
     * @param excludeMsgValue If true, exclude msg.value from native token balance (for initial snapshot)
     * @return Current balance of the token
     */
    function _getBalance(address token, bool excludeMsgValue) private view returns (uint256) {
        if (token == NATIVE_TOKEN) {
            if (excludeMsgValue) {
                // Exclude msg.value for initial snapshot to avoid double-counting
                // Balance should always be >= msg.value when receiving a payable call
                if (address(this).balance < msg.value) {
                    revert InvalidBalanceState();
                }
                return address(this).balance - msg.value;
            }
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev Approve token to spender, handling non-standard tokens (e.g. USDT)
     * @param token Token address to approve
     * @param spender Address to approve tokens to
     * @param amount Amount to approve
     */
    function _approveToken(address token, address spender, uint256 amount) private {
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance == amount) return;
        IERC20(token).forceApprove(spender, amount);
    }

    /**
     * @dev Reset token approval to 0 for a spender
     * @param token Token address to reset approval for
     * @param spender Address to reset approval to
     */
    function _resetApproval(address token, address spender) private {
        _approveToken(token, spender, 0);
    }

    // Residual Sweep
    // ------------------------------------------------------------

    /**
     * @dev Validate final balances and sweep residuals in a single pass
     * @param tokens Array of token recipients (token + beneficiary pairs)
     * @param initialBalances Array of initial balances before execution
     * @param sponsoredToken Token whose residuals should refund to the sponsored authorizer
     * @param sponsoredAuthorizer Address to receive residual sponsored tokens
     * @dev This prevents users from consuming pre-existing contract balances
     * @dev More gas efficient than separate validation and sweep loops
     * @dev Each token's residuals are sent to its specific beneficiary, except sponsored-token
     *      residuals which refund to the sponsored authorizer
     */
    function _validateAndSweepResiduals(
        TokenRecipient[] memory tokens,
        uint256[] memory initialBalances,
        address sponsoredToken,
        address sponsoredAuthorizer
    ) private {
        for (uint256 i; i < tokens.length; ++i) {
            uint256 currentBalance = _getBalance(tokens[i].token, false);

            // Validate: final balance must not be less than initial balance
            if (currentBalance < initialBalances[i]) {
                revert InsufficientFinalBalance(tokens[i].token, currentBalance, initialBalances[i]);
            }

            // Sweep: transfer any balance increase to token's specific beneficiary
            if (currentBalance > initialBalances[i]) {
                uint256 amount = currentBalance - initialBalances[i];
                address residualRecipient = tokens[i].beneficiary;
                if (sponsoredAuthorizer != address(0) && tokens[i].token == sponsoredToken) {
                    residualRecipient = sponsoredAuthorizer;
                }

                if (tokens[i].token == NATIVE_TOKEN) {
                    (bool success,) = payable(residualRecipient).call{value: amount}("");
                    if (!success) revert NativeTransferFailed();
                } else {
                    IERC20(tokens[i].token).safeTransfer(residualRecipient, amount);
                }

                emit ResidualSwept(residualRecipient, tokens[i].token, amount);
            }
        }
    }

    // ============================================================
    // INTERNAL FUNCTIONS - EXECUTION LOGIC
    // ============================================================

    // Instruction Execution
    // ------------------------------------------------------------

    /**
     * @dev Execute all instructions sequentially
     * @param instructions Array of instructions to execute
     */
    function _executeInstructions(Instruction[] calldata instructions) private {
        for (uint256 i; i < instructions.length; ++i) {
            _executeSingleInstruction(instructions[i], i);
        }
    }

    /**
     * @dev Validate instruction configuration
     * @param instruction Instruction to validate
     * @param index Instruction index for error reporting
     */
    function _validateInstruction(Instruction calldata instruction, uint256 index) private view {
        // Target cannot be zero address or this contract
        if (instruction.target == address(0) || instruction.target == address(this)) {
            revert InvalidInstruction(index);
        }

        // Cannot approve address(0) or native token
        if (
            (instruction.tokenIn == address(0) || instruction.tokenIn == NATIVE_TOKEN)
                && instruction.amountToApprove > 0
        ) {
            revert InvalidApprovalConfig(index);
        }

        // Cannot validate output for no token
        if (instruction.tokenOut == address(0) && instruction.minTokenOut > 0) {
            revert InvalidOutputConfig(index);
        }
    }

    /**
     * @dev Execute single instruction with smart token handling
     * @param instruction Instruction to execute
     * @param index Instruction index for error reporting
     * Flow: validate → approve tokenIn → snapshot tokenOut → execute → validate output
     */
    function _executeSingleInstruction(Instruction calldata instruction, uint256 index) private {
        _validateInstruction(instruction, index);

        // Handle token approval if needed
        bool needsApproval = instruction.amountToApprove > 0;
        if (needsApproval) {
            _approveToken(instruction.tokenIn, instruction.target, instruction.amountToApprove);
        }

        // Snapshot balance before if output validation required
        uint256 balanceBefore;
        bool validateOutput = instruction.minTokenOut > 0;
        if (validateOutput) {
            balanceBefore = _getBalance(instruction.tokenOut, false);
        }

        // Execute instruction
        (bool success, bytes memory returnData) = instruction.target.call{value: instruction.value}(instruction.data);
        if (!success) {
            _revertWithData(returnData, index);
        }

        // Reset approval after successful execution
        if (needsApproval) {
            _resetApproval(instruction.tokenIn, instruction.target);
        }

        // Validate output amount if required
        if (validateOutput) {
            uint256 balanceAfter = _getBalance(instruction.tokenOut, false);
            uint256 received = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;
            if (received < instruction.minTokenOut) {
                revert InsufficientOutput(index, instruction.tokenOut, received, instruction.minTokenOut);
            }
        }
    }

    /**
     * @dev Revert with custom error data if available
     * @param returnData Error data from failed call
     * @param index Instruction index for error reporting
     */
    function _revertWithData(bytes memory returnData, uint256 index) private pure {
        if (returnData.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
        revert ExecutionFailed(index);
    }

    // ============================================================
    // INTERNAL FUNCTIONS - GASLESS RELAYING
    // ============================================================

    /**
     * @dev Validate and decode gasless token input for executeSponsored()
     * @param tokenInputs Token inputs array (must contain exactly one ERC3009_RECEIVE input)
     * @param tokens Token recipient array used for residual sweeping and sponsored-token tracking
     * @return tokenReceiveAuthorization Decoded ERC-3009 receiveWithAuthorization payload
     */
    function _validateAndDecodeSponsoredTokenInput(TokenInput[] calldata tokenInputs, TokenRecipient[] calldata tokens)
        private
        pure
        returns (ERC3009TokenReceiveAuthorization memory tokenReceiveAuthorization)
    {
        if (tokenInputs.length != 1) revert SingleSponsoredTokenInputRequired();

        TokenInput calldata input = tokenInputs[0];
        _validateSponsoredTokenInput(input, tokens);

        (
            tokenReceiveAuthorization.from,
            tokenReceiveAuthorization.validAfter,
            tokenReceiveAuthorization.validBefore,
            tokenReceiveAuthorization.nonce,
            tokenReceiveAuthorization.v,
            tokenReceiveAuthorization.r,
            tokenReceiveAuthorization.s
        ) = abi.decode(input.permitCalldata, (address, uint256, uint256, bytes32, uint8, bytes32, bytes32));
        tokenReceiveAuthorization.token = input.token;
        tokenReceiveAuthorization.amount = input.amount;

        if (tokenReceiveAuthorization.from == address(0)) revert InvalidSponsoredAuthorizer();
    }

    /**
     * @dev Extract the ERC-3009 fields that the Adapter signer must bind.
     * @param tokenReceiveAuthorization Decoded ERC-3009 receiveWithAuthorization payload
     * @return Signed authorization without nonce or signature parts
     */
    function _toSponsoredAuthorization(ERC3009TokenReceiveAuthorization memory tokenReceiveAuthorization)
        private
        pure
        returns (IAdapter.SponsoredAuthorization memory)
    {
        return IAdapter.SponsoredAuthorization({
            from: tokenReceiveAuthorization.from,
            token: tokenReceiveAuthorization.token,
            amount: tokenReceiveAuthorization.amount,
            validAfter: tokenReceiveAuthorization.validAfter,
            validBefore: tokenReceiveAuthorization.validBefore
        });
    }

    /**
     * @dev Validate static sponsored token input fields before decoding authorization calldata
     * @param input Sponsored token input to validate
     * @param tokens Token recipient array used for residual sweeping and sponsored-token tracking
     */
    function _validateSponsoredTokenInput(TokenInput calldata input, TokenRecipient[] calldata tokens) private pure {
        if (input.permitType != PermitType.ERC3009_RECEIVE) revert ERC3009Required();
        if (input.amount == 0) revert ZeroSponsoredAmount();
        if (input.token == address(0) || input.token == NATIVE_TOKEN) revert InvalidSponsoredToken();
        if (!_isTokenTracked(tokens, input.token)) revert SponsoredTokenNotInParamsTokens();
        if (input.permitCalldata.length != _ERC3009_RECEIVE_AUTHORIZATION_CALLDATA_LENGTH) {
            revert InvalidERC3009PermitCalldataLength();
        }
    }

    /**
     * @dev Check whether a token appears in the TokenRecipient array
     * @param tokens Token recipient array to scan
     * @param token Token address to look for
     * @return True if the token is found
     */
    function _isTokenTracked(TokenRecipient[] calldata tokens, address token) private pure returns (bool) {
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i].token == token) return true;
        }
        return false;
    }

    /**
     * @dev Execute the validated ERC-3009 authorization and pull sponsored tokens into the adapter
     * @param tokenReceiveAuthorization Decoded ERC-3009 receiveWithAuthorization payload
     */
    function _receiveSponsoredTokens(ERC3009TokenReceiveAuthorization memory tokenReceiveAuthorization) private {
        IERC3009Token(tokenReceiveAuthorization.token).receiveWithAuthorization(
            tokenReceiveAuthorization.from,
            address(this),
            tokenReceiveAuthorization.amount,
            tokenReceiveAuthorization.validAfter,
            tokenReceiveAuthorization.validBefore,
            tokenReceiveAuthorization.nonce,
            tokenReceiveAuthorization.v,
            tokenReceiveAuthorization.r,
            tokenReceiveAuthorization.s
        );
    }

    // ============================================================
    // RECEIVE NATIVE TOKEN
    // ============================================================

    /// @notice Receive native token
    receive() external payable {}
}
