## Economical Fee Oracle

Author: Zsolt Felfoldi (zsfelfoldi@ethereum.org)

The [Economical Fee Oracle](https://github.com/zsfelfoldi/feehistory/blob/main/js/feeOracle.js) is provided as an example for an EIP-1559 transaction fee calculation algorithm based on the `eth_feeHistory` API.

### Usage

This "oracle" calculates suggested fees for different time preferences. The function `suggestFees()` returns a list of suggested `maxFeePerGas` / `maxPriorityFeePerGas` pairs where the index of the list is the `timeFactor`. A low `timeFactor` should be used for urgent transactions while higher values yield more economical suggestions that are expected to require more blocks to get included with a given chance. Note that the relationship between `timeFactor` and inclusion chance in future blocks is not exactly determined but depends on the market behavior. Some rough estimates for this relationship might be calculated once we have actual market data to analyze.

The application frontend might display the suggested fees vs time factor as a bar graph or curve. The steepness of this curve might also give a hint to users on whether there is currently a local congestion.

### Algorithm

The oracle first requests `eth_feeHistory("0x64", "latest")` which is a cheap request (even with a light client backend) because it only requires block headers. The result contains the `baseFee` and `gasUsedRatio` history for the last 100 blocks but no priority fee (effective reward) information. The `baseFee` history is used directly by `suggestBaseFee` to estimate a value under which the `baseFee` is expected to probably fall in the future time period proportional to `timeFactor`. The `gasUsedRatio` is used to find a few recent non-empty and non-full blocks where `suggestPriorityFee` can do another `eth_feeHistory` request, this time also requesting the required `rewardPercentile` in order to make a suggestion for the priority fee.

#### suggestPriorityFee

The 5 most recent non-empty and non-full blocks (`0 < gasUsedRatio <= 0.9`) are selected and the specified `rewardPercentile` of each of those blocks is queried. The resulting reward values are sorted and the final priority fee suggestion is selected from that sorted list based on the `rewardBlockPercentile` value.

The resulting suggestion is on the lower end of the effective rewards of recently included transactions (where that reward has been proven enough). Setting both `rewardPercentile` and `rewardBlockPercentile` to zero will result in the absolute minimum of recent rewards being selected. The default settings are non-zero in order to filter out outliers. A non-zero `rewardPercentile` is supposed to filter out each miner's own transactions with potentially too low rewards in each block while `rewardBlockPercentile` filters out blocks with unusually low miner reward thresholds.

#### predictMinBaseFee

The oracle tries to offer economical fee suggestions based on the assumption that `baseFee` usually fluctuates around a market equilibrium and therefore past `baseFee` history in a given timeframe is a somewhat good indicator of future fluctuation in a similar timeframe. This assumption might not apply when fundamental market conditions are changed but if the initial, economical fee suggestion does not succeed in getting the transaction included then the offered fees can still be increased.

Base fees of full blocks (where `gasUsedRatio > 0.9`) are not considered relevant because getting in those blocks might have required excessive priority fees offsetting the `baseFee` difference compared to the next block. Therefore the base fee history is preprocessed in a way that the base fee of every full block is replaced by that of the next non-full block. The last (pending) block is also assumed to be full and its `baseFee` value is multiplied by `9/8` which yields the assumed `baseFee` of the next block in case the pending one indeed ends up full. This is a worst case estimation that gives some upwards bias to more urgent (low `timeFactor`) suggestions.

Finally, for each `timeFactor` the pre-processed `baseFee` history is weighted with a proportionally sized exponential time window (each block's value is weighted with `Math.exp(block.age / timeFactor)`) and the percentile range between `sampleMinPercentile` and `sampleMaxPercentile` is averaged out with a half-sine time window function. This yields a predicted base fee value as a function of `timeFactor`.

#### Final fee parameter suggestions

In most cases the base fee suggestions as a funtion of `timeFactor` are monotonically decreasing because the weighted `baseFee` values corresponding to a higher `timeFactor` are selected from a longer history and therefore have higher variance and selecting a low percentile value from a higher variance set yields a higher downwards deviation from the mean. In plain words this means that a fluctuating `baseFee` is expected to reach lower values with a given probability under a longer time period. If the base fees are indeed monotonically decreasing with `timeFactor` then the final suggestions are calculated as

```
maxPriorityFeePerGas = suggestedPriorityFee		// constant over the entire timeFactor range
maxFeePerGas = predictedBaseFee[timeFactor] + suggestedPriorityFee
```

On the other hand, if `predictedBaseFee` increases with `timeFactor` then the `baseFee` is currently unusually low compared to longer term history. In this case we assume that it might rise back soon, meaning that we can't necessarily expect to fit into the next few blocks with the minimum necessary priority fee because there might be a competition for getting into those blocks with a lower base fee. For this reason we define `maxBaseFeeAfter[timeFactor] =  MAX(predictedBaseFee[i])` where `i >= timeFactor` and the final formula looks like this:

```
maxPriorityFeePerGas = suggestedPriorityFee + (maxBaseFeeAfter[timeFactor] - predictedBaseFee[timeFactor]) * extraPriorityFeeRatio
maxFeePerGas = maxBaseFeeAfter[timeFactor] + suggestedPriorityFee
```

Note that for `maxFeePerGas` we always offer the longer timeframe estimation if it's higher than the short term one but with the extra priority fee offered we hope that we might still get in earlier with a lower `baseFee` and pay less overall.
