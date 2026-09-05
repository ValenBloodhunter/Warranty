(function () {
  "use strict";

  // ---------------------------------------------------------------
  // logGamma(x)
  //
  // Returns ln(Gamma(x)) — the natural log of the Gamma function.
  // Gamma(n) = (n-1)! for whole numbers, but we need it for the
  // binomial formula below, where n can be in the thousands and
  // n! would overflow a normal number instantly. Working in log
  // space keeps everything small and safe.
  //
  // This is the standard Lanczos approximation — every language's
  // math library uses some version of this under the hood.
  // ---------------------------------------------------------------
  function logGamma(x) {
    const g = 7;
    const c = [
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

    if (x < 0.5) {
      // reflection formula, for small/negative inputs
      return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    }

    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;

    for (let i = 1; i < g + 2; i++) {
      a += c[i] / (x + i);
    }

    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // ---------------------------------------------------------------
  // logChoose(n, k)
  //
  // Returns ln(n choose k) — the log of "how many ways can you
  // pick k items from n". Built from logGamma because
  // n choose k = n! / (k! * (n-k)!), and in log space that
  // division becomes subtraction.
  // ---------------------------------------------------------------
  function logChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
  }

  // ---------------------------------------------------------------
  // binomCDF(k, n, p)
  //
  // Answers: "If I flip a coin with probability p of failure, n
  // times, what's the chance I see k or fewer failures?"
  //
  // We use this to test a hypothesis: "is the true failure rate
  // at most eps?" If we actually observed k failures out of n
  // calibration examples, and that would be a very UNLIKELY
  // outcome under the assumption that the true rate is eps,
  // that's evidence the true rate is really higher than eps —
  // so we can't certify.
  // ---------------------------------------------------------------
  function binomCDF(k, n, p) {
    if (p <= 0) return 1;
    if (p >= 1) return k >= n ? 1 : 0;

    let sum = 0;
    for (let i = 0; i <= k; i++) {
      const logP =
        logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p);
      sum += Math.exp(logP);
    }
    return Math.min(1, sum);
  }

  // ---------------------------------------------------------------
  // wilson(successes, n, z)
  //
  // A quick, well-known confidence interval for "what's the true
  // success rate, given `successes` out of `n` observed trials".
  // z defaults to ~1.96, which is the value for 95% confidence.
  // Not used by certify() itself, but handy for showing error
  // bars anywhere else in the dashboard.
  // ---------------------------------------------------------------
  function wilson(successes, n, z) {
    z = z || 1.959963984540054;
    if (n === 0) return { lower: 0, upper: 1 };

    const phat = successes / n;
    const denom = 1 + (z * z) / n;
    const center = phat + (z * z) / (2 * n);
    const margin =
      z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));

    return {
      lower: (center - margin) / denom,
      upper: (center + margin) / denom
    };
  }

  // ---------------------------------------------------------------
  // riskUpperBound(failures, n, delta)
  //
  // Given that we observed `failures` out of `n` calibration
  // examples, this finds the worst-case true failure rate we can
  // still be (1 - delta) confident is not exceeded. This is the
  // "exact binomial" / Clopper-Pearson style upper confidence
  // bound, found by binary search instead of a closed formula.
  // ---------------------------------------------------------------
  function riskUpperBound(failures, n, delta) {
    if (n === 0) return 1;

    let lo = 0;
    let hi = 1;

    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      const cdf = binomCDF(failures, n, mid);

      // If seeing `failures` or fewer would still be reasonably
      // likely (cdf > delta) at true rate = mid, mid isn't ruled
      // out yet — push the search bound up.
      if (cdf > delta) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return hi;
  }

  // ---------------------------------------------------------------
  // certify(scores, losses, eps, delta)
  //
  // scores  — one p-hat per calibration example (how confident the
  //           router was that the cheap model would succeed)
  // losses  — one 0/1 per calibration example (1 = routing to
  //           cheap would have been a mistake here)
  // eps     — the maximum regression rate the person allows
  //           (from the slider, e.g. 0.08 for 8%)
  // delta   — how confident we need to be (0.05 = 95% confidence)
  //
  // Goal: find the most permissive threshold tau (the one that
  // sends the MOST traffic to the cheap model) such that we can
  // still be (1 - delta) confident the true regression rate for
  // everything routed to cheap is at most eps.
  //
  // Returns null if NO threshold is safe (this is what makes the
  // dashboard show "REFUSED").
  // ---------------------------------------------------------------
  function certify(scores, losses, eps, delta) {
    delta = delta || 0.05;

    const n = scores.length;
    if (n === 0) return null;

    // Pair each score with its loss, sorted highest-confidence first.
    const paired = scores
      .map(function (s, i) {
        return { score: s, loss: losses[i] };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });

    // Try sending the MOST traffic to cheap first (cut = n, tau =
    // the lowest score in the whole set), and only get stricter
    // if that isn't safe. The first cut that IS safe is the best
    // (most permissive) answer.
    for (let cut = n; cut >= 1; cut--) {
      const tau = paired[cut - 1].score;
      const routed = paired.slice(0, cut);

      const failures = routed.reduce(function (acc, row) {
        return acc + (row.loss ? 1 : 0);
      }, 0);

      const upperBound = riskUpperBound(failures, cut, delta);

      if (upperBound <= eps) {
        return {
          tau: tau,
          n: cut,
          failures: failures,
          empiricalRisk: failures / cut,
          risk: upperBound,
          pValue: binomCDF(failures, cut, eps),
          delta: delta
        };
      }
    }

    return null;
  }

  window.certify = certify;
  window.logGamma = logGamma;
  window.logChoose = logChoose;
  window.binomCDF = binomCDF;
  window.wilson = wilson;
})();