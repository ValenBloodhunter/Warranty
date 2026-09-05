(function () {
  "use strict";

  function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const x = Number(a[i]) || 0;
      const y = Number(b[i]) || 0;

      dot += x * y;
      normA += x * x;
      normB += y * y;
    }

    if (normA === 0 || normB === 0) return 0;

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function predictPHat(row, trainRows, k) {
    k = Number.isFinite(k) ? Math.max(1, Math.floor(k)) : 20;

    if (!row || !Array.isArray(trainRows) || trainRows.length === 0) {
      return 0;
    }

    const neighbours = trainRows
      .filter(function (r) {
        return r && r !== row && Array.isArray(r.vec);
      })
      .map(function (r) {
        return {
          row: r,
          similarity: cosine(row.vec, r.vec)
        };
      })
      .sort(function (a, b) {
        return b.similarity - a.similarity;
      })
      .slice(0, k);

    if (neighbours.length === 0) return 0;

    let weightedSuccess = 0;
    let totalWeight = 0;

    neighbours.forEach(function (item) {
      const weight = Math.max(0, item.similarity);
      const success = item.row.cheap &&
        item.row.cheap.correct === true ? 1 : 0;

      weightedSuccess += weight * success;
      totalWeight += weight;
    });

    if (totalWeight === 0) {
      let successes = 0;

      neighbours.forEach(function (item) {
        if (
          item.row.cheap &&
          item.row.cheap.correct === true
        ) {
          successes++;
        }
      });

      return successes / neighbours.length;
    }

    return weightedSuccess / totalWeight;
  }

  function lossIfCheap(row) {
    if (!row) return 0;

    const cheapWrong = !(
      row.cheap &&
      row.cheap.correct === true
    );

    const frontierRight =
      row.frontier &&
      row.frontier.correct === true;

    return cheapWrong && frontierRight ? 1 : 0;
  }

  function costOf(row, which, prices) {
    if (!row || !prices) return 0;

    const model = row[which];

    if (!model) return 0;

    const inputTokens = Number(model.in_tok) || 0;
    const outputTokens = Number(model.out_tok) || 0;

    const inputPrice = Number(prices.in_per_1m) || 0;
    const outputPrice = Number(prices.out_per_1m) || 0;

    return (
      (inputTokens * inputPrice) / 1000000 +
      (outputTokens * outputPrice) / 1000000
    );
  }

  function simulate(rows, tau, prices, options) {
    options = options || {};
    prices = prices || {};

    const data = Array.isArray(rows) ? rows : [];
    const threshold = Number(tau) || 0;

    const useCache = options.cache === true;
    const useVerify = options.verify === true;
    const tau2 = Number.isFinite(options.tau2)
      ? options.tau2
      : 0.5;

    let totalCost = 0;
    let costAlwaysFrontier = 0;
    let correct = 0;
    let regressionCount = 0;
    let cheapCount = 0;
    let escalatedCount = 0;
    let cacheCount = 0;
    let overheadCost = 0;
    let regretCount = 0;

    const seenQueries = new Set();

    data.forEach(function (row) {
      if (!row) return;

      const frontierCost = costOf(
        row,
        "frontier",
        prices
      );

      const cheapCost = costOf(
        row,
        "cheap",
        prices
      );

      costAlwaysFrontier += frontierCost;

      const query = String(row.query || "");
      let finalCorrect = false;

      if (useCache && seenQueries.has(query)) {
        cacheCount++;
        totalCost += 0;

        if (
          row.cheap &&
          row.cheap.correct === true
        ) {
          finalCorrect = true;
        } else if (
          row.frontier &&
          row.frontier.correct === true
        ) {
          finalCorrect = true;
        }
      } else {
        seenQueries.add(query);

        const phat = Number.isFinite(row.phat)
          ? row.phat
          : 0;

        if (phat >= threshold) {
          cheapCount++;
          totalCost += cheapCost;

          let shouldEscalate = false;

          if (useVerify) {
            const consistency =
              Number(row.self_consistency) || 0;

            const rating =
              Number(row.self_rating) || 0;

            const verificationScore =
              consistency * rating / 100;

            if (verificationScore < tau2) {
              shouldEscalate = true;
            }
          }

          if (shouldEscalate) {
            escalatedCount++;

            const verificationCost =
              cheapCost * 2;

            overheadCost += verificationCost;
            totalCost += verificationCost;
            totalCost += frontierCost;

            finalCorrect =
              row.frontier &&
              row.frontier.correct === true;
          } else {
            finalCorrect =
              row.cheap &&
              row.cheap.correct === true;
          }
        } else {
          totalCost += frontierCost;

          finalCorrect =
            row.frontier &&
            row.frontier.correct === true;
        }
      }

      if (finalCorrect) {
        correct++;
      }

      if (
        !finalCorrect &&
        row.frontier &&
        row.frontier.correct === true
      ) {
        regressionCount++;
      }

      if (
        row.cheap &&
        row.cheap.correct === true &&
        row.frontier &&
        row.frontier.correct === false
      ) {
        regretCount++;
      }
    });

    const n = data.length;

    return {
      cost: totalCost,
      costAlwaysFrontier: costAlwaysFrontier,
      accuracy: n ? correct / n : 0,
      regressionRate: n ? regressionCount / n : 0,
      pctCheap: n ? cheapCount / n : 0,
      pctEscalated: n ? escalatedCount / n : 0,
      pctCache: n ? cacheCount / n : 0,
      overheadCost: overheadCost,
      regretCount: regretCount
    };
  }

  window.Router = {
    cosine: cosine,
    predictPHat: predictPHat,
    lossIfCheap: lossIfCheap,
    costOf: costOf,
    simulate: simulate
  };
})();