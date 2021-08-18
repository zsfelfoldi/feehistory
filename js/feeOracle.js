/*
Economical Fee Oracle
EIP-1559 transaction fee parameter suggestion algorithm based on the eth_feeHistory API
Author: Zsolt Felfoldi (zsfelfoldi@ethereum.org)
Description: https://github.com/zsfelfoldi/feehistory/blob/main/docs/feeOracle.md
*/
var sampleMinPercentile = 10; // sampled percentile range of exponentially weighted baseFee history
var sampleMaxPercentile = 30;

var maxRewardPercentile = 20; // effertive reward value to be selected from each individual block
var minBlockPercentile = 40; // economical priority fee to be selected from sorted individual block reward percentiles
var maxBlockPercentile = 80; // urgent priority fee to be selected from sorted individual block reward percentiles

var maxTimeFactor = 128; // highest timeFactor in the returned list of suggestions (power of 2)
var extraPriorityFeeRatio = 0.25; // extra priority fee offered in case of expected baseFee rise
var fallbackPriorityFee = 2e9; // priority fee offered when there are no recent transactions

/*
suggestFees returns a series of maxFeePerGas / maxPriorityFeePerGas values suggested for different time preferences. The first element corresponds to the highest time preference (most urgent transaction).
The basic idea behind the algorithm is similar to the old "gas price oracle" used in Geth; it takes the prices of recent blocks and makes a suggestion based on a low percentile of those prices. With EIP-1559 though the base fee of each block provides a less noisy and more reliable price signal. This allows for more sophisticated suggestions with a variable width (exponentially weighted) base fee time window. The window width corresponds to the time preference of the user. The underlying assumption is that price fluctuations over a given past time period indicate the probabilty of similar price levels being re-tested by the market over a similar length future time period.
*/
function suggestFees() {
    return suggestFeesAt("latest");
}

// suggestFeesAt returns fee suggestions at the specified block
function suggestFeesAt(head) {
    // feeHistory API call without a reward percentile specified is cheap even with a light client backend because it only needs block headers.
    // Therefore we can afford to fetch a hundred blocks of base fee history in order to make meaningful estimates on variable time scales.
    var feeHistory = eth.feeHistory(0x12c, head);
    var baseFee = []
    var order = [];
    for (var i = 0; i < feeHistory.baseFeePerGas.length; i++) {
        baseFee.push(parseInt(feeHistory.baseFeePerGas[i]));
        order.push(i);
    }

    // If a block is full then the baseFee of the next block is copied. The reason is that in full blocks the minimal priority fee might not be enough to get included.
    // The last (pending) block is also assumed to end up being full in order to give some upwards bias for urgent suggestions.
    baseFee[baseFee.length - 1] *= 9 / 8;
    for (var i = feeHistory.gasUsedRatio.length - 1; i >= 0; i--) {
        if (feeHistory.gasUsedRatio[i] > 0.9) {
            baseFee[i] = baseFee[i + 1];
        }
    }

    order.sort(function compare(a, b) {
        return baseFee[a] - baseFee[b];
    })

    var rewards = collectRewards(parseInt(feeHistory.oldestBlock, 16), feeHistory.gasUsedRatio);
    var result = [];
    var maxBaseFee = 0;
    for (var timeFactor = maxTimeFactor; timeFactor >= 1; timeFactor /= 2) {
        var priorityFee = suggestPriorityFee(rewards, timeFactor);
        var bf = predictMinBaseFee(baseFee, order, timeFactor - 1);
        var t = priorityFee;
        if (bf > maxBaseFee) {
            maxBaseFee = bf;
        } else {
            // If a narrower time window yields a lower base fee suggestion than a wider window then we are probably in a price dip.
            // In this case getting included with a low priority fee is not guaranteed; instead we use the higher base fee suggestion
            // and also offer extra priority fee to increase the chance of getting included in the base fee dip.
            t += (maxBaseFee - bf) * extraPriorityFeeRatio;
            bf = maxBaseFee;
        }
        result.push({
            timeFactor: timeFactor,
            maxFeePerGas: bf + priorityFee,
            maxPriorityFeePerGas: t
        });
    }
    result.reverse();
    return result;
}

// suggestPriorityFee suggests a priority fee (maxPriorityFeePerGas) value that's usually sufficient for blocks that are not full.
function suggestPriorityFee(rewards, timeFactor) {
    if (rewards.length == 0) {
        return fallbackPriorityFee;
    }
    return rewards[Math.floor((rewards.length - 1) * (minBlockPercentile + (maxBlockPercentile - minBlockPercentile) / timeFactor) / 100)];
}

// collectRewards returns a sorted list of low percentile range miner rewards values from the last few suitable blocks.
function collectRewards(firstBlock, gasUsedRatio) {
    var percentiles = [];
    for (var i = 0; i <= maxRewardPercentile; i++) {
        percentiles.push(i);
    }

    var ptr = gasUsedRatio.length - 1;
    var needBlocks = 5;
    var rewards = [];
    while (needBlocks > 0 && ptr >= 0) {
        var blockCount = maxBlockCount(gasUsedRatio, ptr, needBlocks);
        if (blockCount > 0) {
            // feeHistory API call with reward percentile specified is expensive and therefore is only requested for a few non-full recent blocks.
            var feeHistory = eth.feeHistory("0x" + blockCount.toString(16), firstBlock + ptr, percentiles);
            for (var i = 0; i < feeHistory.reward.length; i++) {
                for (var j = 0; j <= maxRewardPercentile; j++) {
                    var reward = parseInt(feeHistory.reward[i][j]);
                    if (reward > 0) {
                        rewards.push(reward);
                    }
                }
            }
            if (feeHistory.reward.length < blockCount) {
                break;
            }
            needBlocks -= blockCount;
        }
        ptr -= blockCount + 1;
    }
    rewards.sort(function(a, b) {
        return a - b;
    });
    return rewards;
}

// maxBlockCount returns the number of consecutive blocks suitable for priority fee suggestion (gasUsedRatio non-zero and not higher than 0.9).
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

// predictMinBaseFee calculates an average of base fees in the sampleMinPercentile to sampleMaxPercentile percentile range of recent base fee history, each block weighted with an exponential time function based on timeFactor.
function predictMinBaseFee(baseFee, order, timeDiv) {
    if (timeDiv < 1e-6) {
        return baseFee[baseFee.length - 1];
    }
    var pendingWeight = (1 - Math.exp(-1 / timeDiv)) / (1 - Math.exp(-baseFee.length / timeDiv));
    var sumWeight = 0;
    var result = 0;
    var samplingCurveLast = 0;
    for (var i = 0; i < order.length; i++) {
        sumWeight += pendingWeight * Math.exp((order[i] - baseFee.length + 1) / timeDiv);
        var samplingCurveValue = samplingCurve(sumWeight * 100);
        result += (samplingCurveValue - samplingCurveLast) * baseFee[order[i]];
        if (samplingCurveValue >= 1) {
            return result;
        }
        samplingCurveLast = samplingCurveValue;
    }
    return result;
}

// samplingCurve is a helper function for the base fee percentile range calculation.
function samplingCurve(percentile) {
    if (percentile <= sampleMinPercentile) {
        return 0;
    }
    if (percentile >= sampleMaxPercentile) {
        return 1;
    }
    return (1 - Math.cos((percentile - sampleMinPercentile) * 2 * Math.PI / (sampleMaxPercentile - sampleMinPercentile))) / 2;
}

// calibrateRange simulates and tests the suggestions for the specified block range and returns the average inclusion chance for each timeFactor value.
function calibrateRange(begin, end) {
    var successRate = [];
    for (var i = maxTimeFactor; i >= 1; i /= 2) {
        successRate.push(0);
    }
    var addRate = 1 / (end + 1 - begin);
    for (var block = begin; block <= end; block++) {
        var predicted = suggestFeesAt(block);
        var actual = eth.feeHistory("0x" + (maxTimeFactor + 1).toString(16), block + maxTimeFactor + 1, [10]);
        for (var i = 0; i < predicted.length; i++) {
            if (canInclude(predicted[i].maxFeePerGas, predicted[i].maxPriorityFeePerGas, predicted[i].timeFactor, actual)) {
                successRate[i] += addRate;
            }
        }
    }
    return successRate;
}

// canInclude returns true if a transaction with the specified parameters could have been included in blockDelay blocks given the actual price data after the suggestion.
function canInclude(maxFee, priorityFee, blockDelay, actual) {
    for (var i = 0; i <= blockDelay; i++) {
        var reward = maxFee - parseInt(actual.baseFeePerGas[i]);
        if (priorityFee < reward) {
            reward = priorityFee;
        }
        if (reward >= parseInt(actual.reward[i][0])) {
            return true;
        }
    }
    return false;
}

// dumpFees returns the fee history data of the specified range in decimal form.
function dumpFees(len, block) {
    var fh = eth.feeHistory(len, block, [10]);
    var bf = fh.baseFeePerGas;
    var bfd = [];
    for (var i = 0; i < bf.length - 1; i++) {
        bfd.push(parseInt(bf[i]));
    }
    var reward = [];
    for (var i = 0; i < bf.length - 1; i++) {
        reward.push(parseInt(fh.reward[i][0]));
    }
    return {
        baseFee: bfd,
        gasUsed: fh.gasUsedRatio,
        reward: reward
    };
}

