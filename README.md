## eth_feeHistory API

This repository provides support material for EIP-1559 transaction fee parametering and the `eth_feeHistory` API. This API provides a more flexible approach to transaction fee suggestions than the old `eth_gasPrice` API by providing more "raw" data and letting application frontends experiment with different fee calculation algorithms suitable for specific use cases. One such fee calculation algorithm is provided as an example. Note that the current version was written "blindly" without any actual market data so further fine tuning might be necessary. Using it as a starting point for EIP-1559 apps and contributing back the experiences/results is encouraged :)

- original API [proposal](https://github.com/zsfelfoldi/feehistory/blob/main/docs/feeHistory.md)
- API [specification](https://github.com/ethereum/eth1.0-specs/blob/master/json-rpc/spec.json#L200)
- Economical Fee Oracle [example code](https://github.com/zsfelfoldi/feehistory/blob/main/js/feeOracle.js)
	- Note that Geth 1.10.6 implements the `eth_feeHistory` incorrectly (uses decimal instead of hex values for `blockCount` and `oldestBlock`). The script will not work correctly with this release version. The bug is already fixed on the master branch and is going to be included in the next release. 
- Economical Fee Oracle [description](https://github.com/zsfelfoldi/feehistory/blob/main/docs/feeOracle.md)

