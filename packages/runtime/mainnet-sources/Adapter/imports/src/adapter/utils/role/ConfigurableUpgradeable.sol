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
import {ConfigurableStorage} from "./storage/ConfigurableStorage.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @title ConfigurableUpgradeable
/// @notice Upgrade‑safe helper providing a dedicated configurator role
/// @dev Must be initialised via {initializeConfigurable} inside the inheriting contractʼs
///      `initialize` function
abstract contract ConfigurableUpgradeable is Initializable, Ownable2StepUpgradeable {
    /// @dev Error thrown when caller is not the configurator
    error NotConfigurator(address caller);

    /// @dev Error thrown when trying to set the same configurator
    error SameConfigurator(address addr);

    /// @dev Error thrown when trying to set zero address as configurator
    error ConfiguratorZeroAddress();

    /// @notice Emitted when the configurator is transferred
    /// @param previousConfigurator The previous configurator address
    /// @param newConfigurator The new configurator address
    event ConfiguratorTransferred(address indexed previousConfigurator, address indexed newConfigurator);

    /// @dev Modifier that restricts the caller to the current configurator
    modifier onlyConfigurator() {
        if (_msgSender() != ConfigurableStorage.layout().configurator) {
            revert NotConfigurator(_msgSender());
        }
        _;
    }

    /// @notice Internal initialiser that must be called during the inheriting contractʼs initialise flow
    /// @param initialConfigurator The address that will receive the configurator role
    function _initializeConfigurable(address initialConfigurator) internal virtual onlyInitializing {
        ConfigurableStorage.layout().configurator = initialConfigurator;
        emit ConfiguratorTransferred(address(0), initialConfigurator);
    }

    /// @notice Returns the current configurator address
    /// @return The address of the current configurator
    function configurator() public view virtual returns (address) {
        return ConfigurableStorage.layout().configurator;
    }

    /// @notice Assign a new configurator
    /// @dev Callable only by the contract owner. Set to `address(0)` to remove the role
    /// @param newConfigurator The new configurator address
    function updateConfigurator(address newConfigurator) external virtual onlyOwner {
        if (newConfigurator == address(0)) revert ConfiguratorZeroAddress();
        _updateConfigurator(newConfigurator);
    }

    /// @notice Removes the current configurator (sets to address(0))
    /// @dev Callable only by the contract owner
    function removeConfigurator() external virtual onlyOwner {
        _updateConfigurator(address(0));
    }

    /// @dev Internal helper to update the configurator
    /// @param newConfigurator The new configurator address
    function _updateConfigurator(address newConfigurator) internal virtual {
        ConfigurableStorage.Layout storage $ = ConfigurableStorage.layout();
        address oldConfigurator = $.configurator;
        if (newConfigurator == oldConfigurator) {
            revert SameConfigurator(newConfigurator);
        }
        $.configurator = newConfigurator;
        emit ConfiguratorTransferred(oldConfigurator, newConfigurator);
    }
}
