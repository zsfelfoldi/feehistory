## Fee Oracle

Author: Zsolt Felfoldi (zsfelfoldi@ethereum.org)

The [Fee Oracle](https://github.com/zsfelfoldi/feehistory/blob/main/js/feeOracle.js) is provided as an example for an EIP-1559 transaction fee calculation algorithm based on the `eth_feeHistory` API.

### Usage

This "oracle" calculates suggested fees for different time preferences. The function `suggestFees()` returns a list of suggested `maxFeePerGas` / `maxPriorityFeePerGas` pairs where the index of the list is the `timeFactor`. A low `timeFactor` should be used for urgent transactions while higher values yield more economical suggestions that are expected to require more blocks to get included with a given chance. Note that the relationship between `timeFactor` and inclusion chance in future blocks is not exactly determined but depends on the market behavior. Some rough estimates for this relationship might be calculated once we have actual market data to analyze.

The application frontend might display the fees vs time factor as a bar graph or curve. The steepness of this curve might also give a hint to users on whether there is currently a local congestion.

### Algorithm description

[...]

