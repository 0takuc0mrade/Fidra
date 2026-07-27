// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only token that removes a 1% fee from ordinary transfers.
contract FeeOnTransferUSDC is ERC20 {
    address private constant FEE_SINK = address(0xdead);

    constructor() ERC20("Fee-on-transfer USDC", "fUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = value / 100;
        super._update(from, FEE_SINK, fee);
        super._update(from, to, value - fee);
    }
}
