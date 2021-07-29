/*
Fee Oracle
EIP-1559 transaction fee parameter suggestion algorithm based on the eth_feeHistory API
Author: Zsolt Felfoldi (zsfelfoldi@ethereum.org)
Description: https://github.com/zsfelfoldi/feehistory/blob/main/docs/feeOracle.md
*/

var sampleMin = 0.1;
var sampleMax = 0.3;
var maxTimeFactor = 15;
var extraTipRatio = 0.25;
var fallbackTip = 2e9;

/*
suggestFees returns a series of maxFeePerGas / maxPriorityFeePerGas values suggested for different time preferences. The first element corresponds to the highest time preference (most urgent transaction).
The basic idea behind the algorithm is similar to the old "gas price oracle" used in Geth; it takes the prices of recent blocks and makes a suggestion based on a low percentile of those prices. With EIP-1559 though the base fee of each block provides a less noisy and more reliable price signal. This allows for more sophisticated suggestions with a variable width (exponentially weighted) base fee time window. The window width corresponds to the time preference of the user. The underlying assumption is that price fluctuations over a given past time period indicate the probabilty of similar price levels being re-tested by the market over a similar length future time period.
*/
function suggestFees() {
    // feeHistory API call without a reward percentile specified is cheap even with a light client backend because it only needs block headers.
    // Therefore we can afford to fetch a hundred blocks of base fee history in order to make meaningful estimates on variable time scales.
    var feeHistory = eth.feeHistory("0x64", "latest");
    var baseFee = []
    var order = [];
    for (var i = 0; i < feeHistory.baseFeePerGas.length; i++) {
        baseFee.push(parseInt(feeHistory.baseFeePerGas[i]));
        order.push(i);
    }

    // If a block is full then the baseFee of the next block is copied. The reason is that in full blocks the minimal tip might not be enough to get included.
    // The last (pending) block is also assumed to end up being full in order to give some upwards bias for urgent suggestions.
    baseFee[baseFee.length - 1] *= 9 / 8;
    for (var i = feeHistory.gasUsedRatio.length - 1; i >= 0; i--) {
        if (feeHistory.gasUsedRatio[i] > 0.9) {
            baseFee[i] = baseFee[i + 1];
        }
    }

    order.sort(function compare(a, b) {
        var aa = baseFee[a];
        var bb = baseFee[b];
        if (aa < bb) {
            return -1;
        }
        if (aa > bb) {
            return 1;
        }
        return 0;
    })

    var tip = suggestTip(parseInt(feeHistory.oldestBlock, 16), feeHistory.gasUsedRatio);
    var result = [];
    var maxBaseFee = 0;
    for (var timeFactor = maxTimeFactor; timeFactor >= 0; timeFactor--) {
        var bf = suggestBaseFee(baseFee, order, timeFactor);
        var t = tip;
        if (bf > maxBaseFee) {
            maxBaseFee = bf;
        } else {
            // If a narrower time window yields a lower base fee suggestion than a wider window then we are probably in a price dip.
            // In this case getting included with a low tip is not guaranteed; instead we use the higher base fee suggestion
            // and also offer extra tip to increase the chance of getting included in the base fee dip.
            t += (maxBaseFee - bf) * extraTipRatio;
            bf = maxBaseFee;
        }
        result[timeFactor] = {
            maxFeePerGas: bf + t,
            maxPriorityFeePerGas: t
        };
    }
    return result;
}

// suggestTip suggests a tip (maxPriorityFeePerGas) value that's usually sufficient for blocks that are not full.
function suggestTip(firstBlock, gasUsedRatio) {
    var ptr = gasUsedRatio.length - 1;
    var needBlocks = 5;
    var rewards = [];
    while (needBlocks > 0 && ptr >= 0) {
        var blockCount = maxBlockCount(gasUsedRatio, ptr, needBlocks);
        if (blockCount > 0) {
            // feeHistory API call with reward percentile specified is expensive and therefore is only requested for a few non-full recent blocks.
            var feeHistory = eth.feeHistory("0x"+blockCount.toString(16), firstBlock + ptr, [0]);
            for (var i = 0; i < feeHistory.reward.length; i++) {
                rewards.push(parseInt(feeHistory.reward[i][0]));
            }
            if (feeHistory.reward.length < blockCount) {
                break;
            }
            needBlocks -= blockCount;
        }
        ptr -= blockCount + 1;
    }

    if (rewards.length == 0) {
        return fallbackTip;
    }
    rewards.sort();
    return rewards[Math.floor(rewards.length / 2)];
}

// maxBlockCount returns the number of consecutive blocks suitable for tip suggestion (gasUsedRatio non-zero and not higher than 0.9).
function maxBlockCount(gasUsedRatio, ptr, needBlocks) {
    var blockCount = 0;
    while (needBlocks > 0 && ptr >= 0) {
        if (gasUsedRatio[ptr] == 0 || gasUsedRatio[ptr] > 0.9) {
            break;
        }
        ptr--;
        needBlocks--;
        blockCount++;
    }
    return blockCount;
}

// suggestBaseFee calculates an average of base fees in the sampleMin to sampleMax percentile range of recent base fee history, each block weighted with an exponential time function based on timeFactor.
function suggestBaseFee(baseFee, order, timeFactor) {
    if (timeFactor < 1e-6) {
        return baseFee[baseFee.length - 1];
    }
    var pendingWeight = (1 - Math.exp(-1 / timeFactor)) / (1 - Math.exp(-baseFee.length / timeFactor));
    var sumWeight = 0;
    var result = 0;
    var samplingCurveLast = 0;
    for (var i = 0; i < order.length; i++) {
        sumWeight += pendingWeight * Math.exp((order[i] - baseFee.length + 1) / timeFactor);
        var samplingCurveValue = samplingCurve(sumWeight);
        result += (samplingCurveValue - samplingCurveLast) * baseFee[order[i]];
        if (samplingCurveValue >= 1) {
            return result;
        }
        samplingCurveLast = samplingCurveValue;
    }
    return result;
}

// samplingCurve is a helper function for the base fee percentile range calculation.
function samplingCurve(sumWeight) {
    if (sumWeight <= sampleMin) {
        return 0;
    }
    if (sumWeight >= sampleMax) {
        return 1;
    }
    return (1 - Math.cos((sumWeight - sampleMin) * 2 * Math.PI / (sampleMax - sampleMin))) / 2;
}

