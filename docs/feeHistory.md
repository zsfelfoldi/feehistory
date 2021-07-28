Author: Zsolt Felfoldi (zsfelfoldi@ethereum.org)

#### Call formats

This proposal defines a new GPO API function for new EIP-1559 compatible wallets:

```
feeHistory(blockCount, lastBlock) (firstBlock, []baseFee, []gasUsedRatio)
feeHistory(blockCount, lastBlock, []rewardPercentile) (firstBlock, [][]reward, []baseFee, []gasUsedRatio)
```

This function can provide for everything proposed in the [1559 API Wishlist](https://hackmd.io/@timbeiko/1559-api-wishlist). It retrieves `blockCount` blocks, ending with the one specified by `lastBlock`. `lastBlock` can be an absolute block number, the current head block (-1) or the current pending block (-2). Support for pending block analysis is optional because it requires the backend to have a pending state. 

The results extracted from these blocks are returned in the form of three arrays. If `lastBlock` points to the pending block while it is not supported then the arrays will be one block shorter. The caller should be prepared for that. The returned `firstBlock` value points to the first block (corresponding to the first element of the arrays) in order to avoid ambiguity when the head block is changed during the API call.

Explicitly specifying head block vs pending block for `lastBlock` avoids some ambiguity with the pending block support being optional. Specifying an absolute number is useful for long-term history visualization which I increasingly believe will be super important for understanding the fee market. Though we can also support the earlier proposed simpler definitions:

```
recentFeeHistory(blockCount) ([]baseFee, []gasUsedRatio)
recentFeeHistory(blockCount, []rewardPercentile) ([][]reward, []baseFee, []gasUsedRatio)
```

In this simpler version the count is always counted from the current head and if pending block is supported then arrays are just one block longer.

#### Specification of the results

- `[][]reward`: this is a two-dimensional array where the inner arrays corresponding to each block all have the same length as `[]rewardPercentile`. For each `rewardPercentile` value the corresponding miner reward amount is returned. See below for the exact method of `reward` calculation. Omitting `[]rewardPercentile` disables the reward calculation when only the base fee history is needed (which is a lot cheaper to obtain).
- `[]baseFee`: the base fee of each block, plus the block after `lastBlock` which means `[]baseFee` is always one block longer than the other two lists. This is true even if `lastBlock` is the pending block. In this case a projected value is calculated based on the current `gasUsed` of the pending state. If pending block analysis is not supported then still the `baseFee` of the pending block should be returned because this value can be calculated from the current head block.
- `[]gasUsedRatio`: `gasUsed / (gasTarget * ElasticityMultiplier)`. Not absolutely necessary because it could be calculated back from the change of the base fee but probably more convenient and more future safe if `ElasticityMultiplier` or the base fee adjustment is changed.

Filtering out price data of full blocks is easy for the caller so I believe it's better to not complicate the API with this option, rather provide the raw info that basically any GPO algorithm can make use of. Of course clients should still provide some meaningful values through the old `gasPrice` call while new wallets can use the new API for more flexibility and user options. The old `gasPrice` function could keep using more or less the old algorithm, returning slightly below median of the minimum/low percentile `reward` values of recent blocks, with the added condition that blocks with `gasUsedRatio > 0.9` are filtered out (which doesn't change pre-1559 behavior where `gasUsedRatio` is constant `0.5`).

Note: I propose a combined call to fetch reward and base fee data (instead of a separate `reward` and `baseFee` function) because this eliminates the risk of the head block changing between fetching the two types of data. Base fee is much cheaper to obtain than the rewards so this does not create a significant performance loss even if only the rewards are needed.

#### Miner reward percentile calculation

The transactions of the given block are sorted in ascending order of effective miner reward (`tx.minerReward = MIN(tx.maxPriorityFeePerGas, tx.maxFeePerGas-block.baseFee)`). For each individual `rewardPercentile` value we calculate the reward with the following function:


```
targetGas = rewardPercentile * block.gasUsed / 100  // rewardPercentile is a float value for increased resolution
sumGas = 0
for tx = range sortedTxs
	sumGas += tx.gasUsed
	if targetGas <= sumGas
		return tx.minerReward
```

Note: actually all reward values can be calculated with a single iteration but I wrote this unoptimized version for clarity. Calculating multiple reward percentiles for each block is a minimal overhead over calculating a single one and using multiple values can be more informative for GPOs than a single one (or at least less noisy when averaging them out, the current Geth GPO also does that with 3 samples). Calculating a high resolution series of reward percentiles can be useful for visualization and deeper analysis of the fee market. If pending block analysis is supported then the live visualization of the pending block's reward distribution could also be interesting.

