(function () {
  "use strict";

  // ============================================================
  // LOG GAMMA
  // ============================================================

  function logGamma(x) {
    const coefficients = [
      0.99999999999980993,
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7
    ];

    const g = 7;

    if (x < 0.5) {
      return (
        Math.log(Math.PI) -
        Math.log(Math.sin(Math.PI * x)) -
        logGamma(1 - x)
      );
    }

    x -= 1;

    let a = coefficients[0];

    for (let i = 1; i < coefficients.length; i++) {
      a += coefficients[i] / (x + i);
    }

    const t = x + g + 0.5;

    return (
      0.5 * Math.log(2 * Math.PI) +
      (x + 0.5) * Math.log(t) -
      t +
      Math.log(a)
    );
  }


  // ============================================================
  // LOG BINOMIAL COEFFICIENT
  // ============================================================

  function logChoose(n, k) {
    if (k < 0 || k > n) {
      return -Infinity;
    }

    return (
      logGamma(n + 1) -
      logGamma(k + 1) -
      logGamma(n - k + 1)
    );
  }


  // ============================================================
  // BINOMIAL CDF
  //
  // P(X <= k)
  // ============================================================

  function binomCDF(k, n, p) {
    if (n <= 0) return 1;

    if (k < 0) return 0;

    if (k >= n) return 1;

    if (p <= 0) return 1;

    if (p >= 1) {
      return k >= n ? 1 : 0;
    }

    let sum = 0;

    for (let i = 0; i <= k; i++) {
      const logP =
        logChoose(n, i) +
        i * Math.log(p) +
        (n - i) * Math.log1p(-p);

      sum += Math.exp(logP);

      // Prevent tiny floating point overflow above 1.
      if (sum >= 1) {
        return 1;
      }
    }

    return Math.min(1, Math.max(0, sum));
  }


  // ============================================================
  // CLOPPER-PEARSON UPPER BOUND
  // ============================================================

  function riskUpperBound(failures, n, delta) {
    if (n <= 0) {
      return 1;
    }

    failures = Math.max(
      0,
      Math.min(n, Math.floor(failures))
    );

    delta = Math.max(
      1e-12,
      Math.min(1 - 1e-12, delta)
    );

    let lo = 0;
    let hi = 1;

    // Find p such that:
    //
    // P(X <= failures | p) = delta
    //
    // This is the exact one-sided
    // Clopper-Pearson upper confidence bound.

    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;

      const cdf = binomCDF(
        failures,
        n,
        mid
      );

      if (cdf > delta) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return hi;
  }


  // ============================================================
  // WILSON INTERVAL
  // ============================================================

  function wilson(successes, n, z) {
    z = z || 1.959963984540054;

    if (n <= 0) {
      return {
        lower: 0,
        upper: 1
      };
    }

    const phat = successes / n;

    const denom =
      1 + (z * z) / n;

    const center =
      phat +
      (z * z) / (2 * n);

    const margin =
      z *
      Math.sqrt(
        (phat * (1 - phat)) / n +
        (z * z) / (4 * n * n)
      );

    return {
      lower: Math.max(
        0,
        (center - margin) / denom
      ),

      upper: Math.min(
        1,
        (center + margin) / denom
      )
    };
  }


  // ============================================================
  // WARRANTY CERTIFICATION
  // ============================================================

  function certify(scores, losses, eps, delta) {

    delta =
      Number.isFinite(Number(delta))
        ? Number(delta)
        : 0.05;

    eps = Number(eps);

    // ----------------------------------------------------------
    // Validate inputs
    // ----------------------------------------------------------

    if (!Array.isArray(scores)) {
      console.error(
        "WARRANTY certify(): scores is not an array"
      );
      return null;
    }

    if (!Array.isArray(losses)) {
      console.error(
        "WARRANTY certify(): losses is not an array"
      );
      return null;
    }

    if (scores.length === 0) {
      console.error(
        "WARRANTY certify(): calibration set is empty"
      );
      return null;
    }

    if (scores.length !== losses.length) {
      console.error(
        "WARRANTY certify(): scores/losses length mismatch",
        {
          scores: scores.length,
          losses: losses.length
        }
      );

      return null;
    }

    if (!Number.isFinite(eps)) {
      console.error(
        "WARRANTY certify(): invalid epsilon",
        eps
      );

      return null;
    }

    eps = Math.max(
      0,
      Math.min(1, eps)
    );


    // ----------------------------------------------------------
    // Clean calibration examples
    // ----------------------------------------------------------

    const paired = [];

    for (let i = 0; i < scores.length; i++) {

      const score = Number(scores[i]);

      if (!Number.isFinite(score)) {
        console.warn(
          "WARRANTY: skipping invalid score",
          i,
          scores[i]
        );

        continue;
      }

      const loss =
        Number(losses[i]) === 1
          ? 1
          : 0;

      paired.push({
        score: Math.max(
          0,
          Math.min(1, score)
        ),

        loss
      });
    }


    if (paired.length === 0) {
      console.error(
        "WARRANTY certify(): no valid calibration examples"
      );

      return null;
    }


    // ----------------------------------------------------------
    // Sort highest confidence first.
    // ----------------------------------------------------------

    paired.sort(
      (a, b) => b.score - a.score
    );


    // ----------------------------------------------------------
    // Try every possible threshold.
    //
    // cut = number of calibration examples
    // routed to cheap.
    //
    // Start with the most permissive threshold.
    // ----------------------------------------------------------

    let best = null;

    for (
      let cut = paired.length;
      cut >= 0;
      cut--
    ) {

      const routed =
        paired.slice(0, cut);

      const failures =
        routed.reduce(
          (total, row) =>
            total + row.loss,
          0
        );

      const empiricalRisk =
        failures / cut;

      const upperBound =
        riskUpperBound(
          failures,
          cut,
          delta
        );

      // --------------------------------------------------------
      // Certification condition
      // --------------------------------------------------------

      if (upperBound <= eps) {

        best = {
          tau:
            cut === 0
             ? 1.01
             : routed[routed.length - 1].score,

          n: cut,

          failures,

          empiricalRisk,

          risk: upperBound,

          pValue:
            binomCDF(
              failures,
              cut,
              eps
            ),

          delta
        };

        break;
      }
    }


    // ----------------------------------------------------------
    // Debug information
    // ----------------------------------------------------------

    if (!best) {

      const totalFailures =
        paired.reduce(
          (sum, row) =>
            sum + row.loss,
          0
        );

      const totalRisk =
        totalFailures /
        paired.length;

      const totalUpper =
        riskUpperBound(
          totalFailures,
          paired.length,
          delta
        );

      console.warn(
        "WARRANTY certification refused",
        {
          epsilon: eps,
          delta,
          calibrationN: paired.length,
          calibrationFailures: totalFailures,
          empiricalRisk: totalRisk,
          upperBound: totalUpper
        }
      );

      return null;
    }


    console.log(
      "WARRANTY CERTIFIED",
      best
    );

    return best;
  }


  // ============================================================
  // EXPORT
  // ============================================================

  window.certify = certify;

  window.logGamma = logGamma;
  window.logChoose = logChoose;
  window.binomCDF = binomCDF;
  window.wilson = wilson;
  window.riskUpperBound = riskUpperBound;

})();