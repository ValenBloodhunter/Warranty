// WARRANTY — C8 UI
// Robust certification + routing + baselines + Pareto wiring

(() => {
  "use strict";

  // ============================================================
  // DEFAULT PRICES
  // ============================================================

  const DEFAULT_PRICES = {
    cheap: {
      in_per_1m: 0.15,
      out_per_1m: 0.60
    }
  };
  // ============================================================
  // HELPERS
  // ============================================================

  const $ = id => document.getElementById(id);

  const state = {
    eps: 8,

    tau: 1.01,

    train: [],
    cal: [],
    test: [],

    prices: DEFAULT_PRICES,

    warrantyCurve: [],
    baselines: [],

    current: null,

    certification: null
  };


  function isNumber(x) {
    return Number.isFinite(Number(x));
  }


  function value(obj, keys, fallback = 0) {

    if (!obj) {
      return fallback;
    }

    for (const key of keys) {

      if (
        Object.prototype.hasOwnProperty.call(obj, key) &&
        Number.isFinite(Number(obj[key]))
      ) {
        return Number(obj[key]);
      }
    }

    return fallback;
  }


  function pct(x) {

    const n = Number(x);

    if (!Number.isFinite(n)) {
      return "0.0%";
    }

    return n.toFixed(1) + "%";
  }


  function money(x) {
  const n = Number(x);

  if (!Number.isFinite(n)) {
    return "$0.0000";
  }

  return "$" + n.toFixed(4);
  }


  function clamp01(x) {

    const n = Number(x);

    if (!Number.isFinite(n)) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(1, n)
    );
  }


  // ============================================================
  // DATA LOADING
  // ============================================================

  async function loadJSON(primary, fallback = null) {

    try {

      const response = await fetch(
        primary,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(
          `${primary} returned ${response.status}`
        );
      }

      return await response.json();

    } catch (error) {

      console.warn(
        "WARRANTY: failed to load",
        primary,
        error
      );

      if (!fallback) {
        throw error;
      }

      const response = await fetch(
        fallback,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(
          `${fallback} returned ${response.status}`
        );
      }

      return await response.json();
    }
  }


  function rowsFrom(data) {

    if (Array.isArray(data)) {
      return data;
    }

    if (
      data &&
      Array.isArray(data.rows)
    ) {
      return data.rows;
    }

    if (
      data &&
      Array.isArray(data.data)
    ) {
      return data.data;
    }

    return [];
  }


  function split(rows) {

    return {

      train: rows.filter(
        r => r.split === "train"
      ),

      cal: rows.filter(
        r => r.split === "cal"
      ),

      test: rows.filter(
        r => r.split === "test"
      )
    };
  }


  // ============================================================
  // MODEL CORRECTNESS
  // ============================================================

  function cheapCorrect(row) {

    return Boolean(
      row.cheap_correct ??
      row.cheap?.correct ??
      row.cheap?.is_correct ??
      false
    );
  }


  function frontierCorrect(row) {

    return Boolean(
      row.frontier_correct ??
      row.frontier?.correct ??
      row.frontier?.is_correct ??
      false
    );
  }


  function queryLength(row) {

    return String(
      row.query ?? ""
    ).length;
  }


  // ============================================================
  // COST
  // ============================================================

  function cost(row, which) {

    if (
      window.Router &&
      typeof Router.costOf === "function"
    ) {

      const result =
        Number(
          Router.costOf(
            row,
            which,
            state.prices
          )
        );

      if (Number.isFinite(result)) {
        return result;
      }
    }


    const price =
      state.prices[which] ||
      DEFAULT_PRICES[which];


    const model =
      row[which] || {};


    const inputTokens = Number(
      model.input_tokens ??
      row.input_tokens ??
      100
    );


    const outputTokens = Number(
      model.output_tokens ??
      row.output_tokens ??
      50
    );


    return (
      (inputTokens / 1e6) *
        Number(price.input) +

      (outputTokens / 1e6) *
        Number(price.output)
    );
  }


  // ============================================================
  // DIRECT POLICY
  // ============================================================

  function directPolicy(rows, choose) {

    if (!rows.length) {

      return {
        accuracy: 0,
        cost: 0,
        regret: 0,
        regression: 0,
        cheapPercent: 0,
        costSaved: 0
      };
    }


    let totalCost = 0;
let correctCount = 0;
let regret = 0;
let cheapCount = 0;

rows.forEach((row, index) => {
  const route =
    choose(row, index);

  if (route === "cheap") {
    cheapCount++;
  }

  const rowCorrect =
    route === "cheap"
      ? cheapCorrect(row)
      : frontierCorrect(row);

  if (rowCorrect) {
    correctCount++;
  }


      // Regression means:
      // cheap was selected AND cheap was wrong
      // while frontier was correct.
      if (
        route === "cheap" &&
        !cheapCorrect(row) &&
        frontierCorrect(row)
      ) {
        regret++;
      }


      totalCost += cost(
        row,
        route
      );
    });


    const n = rows.length;


     const accuracy =
       correctCount / n;

    const avgCost =
      totalCost / n;


    const frontierTotal =
      rows.reduce(
        (sum, row) =>
          sum + cost(row, "frontier"),
        0
      );


    const frontierAvg =
      frontierTotal / n;


    const costSaved =
      frontierAvg > 0
        ? (
            1 -
            avgCost / frontierAvg
          ) * 100
        : 0;


    return {

      accuracy,

      cost: avgCost,

      avgCost,

      regret:
        regret / n,

      regression:
        regret / n,

      cheapPercent:
        (cheapCount / n) * 100,

      costSaved:
        Math.max(
          0,
          costSaved
        )
    };
  }


  // ============================================================
  // ROUTER SIMULATION
  // ============================================================

  function routerSim(
  rows,
  tau,
  options = {}
) {
  tau = Number(tau);

  if (!Number.isFinite(tau)) {
    tau = 1.01;
  }

  if (
    window.Router &&
    typeof Router.simulate === "function"
  ) {
    try {
      const raw = Router.simulate(
        rows,
        tau,
        state.prices,
        options
      );

      if (raw) {
        const n = Math.max(1, rows.length);

        const totalCost =
          Number(raw.cost) || 0;

        const frontierCost =
          Number(raw.costAlwaysFrontier) || 0;

        const cheapFraction =
          clamp01(raw.pctCheap);

        const escalatedFraction =
          clamp01(raw.pctEscalated);

        const cacheFraction =
          clamp01(raw.pctCache);

        const regressionFraction =
          clamp01(raw.regressionRate);

        const cheapAcceptedFraction =
          Math.max(
            0,
            cheapFraction - escalatedFraction
          );

        const frontierFraction =
          Math.max(
            0,
            1 - cacheFraction - cheapFraction
          );

        const avgCost =
          totalCost / n;

        const costSavedPercent =
          frontierCost > 0
            ? Math.max(
                0,
                (1 - totalCost / frontierCost) * 100
              )
            : 0;

        const overheadPercent =
          frontierCost > 0
            ? (
                (Number(raw.overheadCost) || 0) /
                frontierCost
              ) * 100
            : 0;

        return {
          ...raw,

          // Cost
          totalCost,
          cost: avgCost,
          avgCost,
          costSavedPercent,

          // Accuracy
          accuracy:
            clamp01(raw.accuracy),

          // Regression
          regression:
            regressionFraction,
          regressionPercent:
            regressionFraction * 100,

          // Main traffic statistic
          cheapPercent:
            cheapFraction * 100,

          // Flow-bar percentages
          cacheHitPercent:
            cacheFraction * 100,

          cheapAcceptedPercent:
            cheapAcceptedFraction * 100,

          escalatedPercent:
            escalatedFraction * 100,

          frontierPercent:
            frontierFraction * 100,

          // Overhead
          overheadPercent,

          // Regret as fraction
          regret:
            (Number(raw.regretCount) || 0) / n
        };
      }

    } catch (error) {
      console.error(
        "WARRANTY Router.simulate error:",
        error
      );
    }
  }

  return directPolicy(
    rows,
    row =>
      Number(row.phat) >= tau
        ? "cheap"
        : "frontier"
  );
}

  // ============================================================
  // CERTIFICATION
  // ============================================================

  function certification() {

    // ----------------------------------------------------------
    // Check Router.
    // ----------------------------------------------------------

    if (!window.Router) {

      console.error(
        "WARRANTY: Router.js is not loaded."
      );

      return null;
    }


    if (
      typeof Router.lossIfCheap !==
      "function"
    ) {

      console.error(
        "WARRANTY: Router.lossIfCheap() is missing."
      );

      return null;
    }


    // ----------------------------------------------------------
    // Check calibration set.
    // ----------------------------------------------------------

    if (!state.cal.length) {

      console.error(
        "WARRANTY: calibration dataset is empty."
      );

      return null;
    }


    // ----------------------------------------------------------
    // Scores.
    // ----------------------------------------------------------

    const scores =
      state.cal.map(row => {

        const p =
          Number(row.phat);

        return Number.isFinite(p)
          ? clamp01(p)
          : 0;
      });


    // ----------------------------------------------------------
    // Losses.
    // ----------------------------------------------------------

    const losses =
      state.cal.map(row => {

        try {

          const loss =
            Router.lossIfCheap(row);

          return Number(loss) === 1
            ? 1
            : 0;

        } catch (error) {

          console.error(
            "WARRANTY: lossIfCheap failed:",
            error,
            row
          );

          return 1;
        }
      });


    // ----------------------------------------------------------
    // Basic diagnostic.
    // ----------------------------------------------------------

    const failures =
      losses.reduce(
        (sum, loss) =>
          sum + loss,
        0
      );


    const epsilon =
      state.eps / 100;


    console.log(
      "WARRANTY certification:",
      {
        epsilonPercent: state.eps,
        epsilon,
        delta: 0.05,
        calibrationRows: state.cal.length,
        failures,
        scores,
        losses
      }
    );


    // ----------------------------------------------------------
    // Call certify.js.
    // ----------------------------------------------------------

    if (
      typeof window.certify !==
      "function"
    ) {

      console.error(
        "WARRANTY: certify() is not loaded."
      );

      return null;
    }


    try {

      const result =
        window.certify(
          scores,
          losses,
          epsilon,
          0.05
        );


      if (!result) {

        console.warn(
          "WARRANTY: no threshold satisfies certification.",
          {
            epsilon,
            delta: 0.05,
            calibrationRows:
              state.cal.length,
            failures
          }
        );
      }


      return result;

    } catch (error) {

      console.error(
        "WARRANTY certification error:",
        error
      );

      return null;
    }
  }


  // ============================================================
  // CERTIFICATION STAMP
  // ============================================================

  function updateStamp(result) {

    const stamp =
      $("certStamp");

    const detail =
      $("stampDetail");


    if (!stamp) {
      return;
    }


    stamp.classList.remove(
      "press"
    );


    // ----------------------------------------------------------
    // REFUSED
    // ----------------------------------------------------------

    if (!result) {

      stamp.textContent =
        "✕ REFUSED — ROUTING 100% TO FRONTIER";


      stamp.className =
        "px-4 py-1.5 rounded-full border border-red-500 text-red-400 text-sm font-medium";


      if (detail) {

        detail.textContent =
          "No certified threshold · routing 100% to frontier · δ = 0.05";
      }


      state.tau = 1.01;

      state.certification = null;

      return;
    }


    // ----------------------------------------------------------
    // CERTIFIED
    // ----------------------------------------------------------

    stamp.textContent =
      "✓ CERTIFIED";


    stamp.className =
      "px-4 py-1.5 rounded-full border border-green-500 text-green-400 text-sm font-medium";


    void stamp.offsetWidth;

    stamp.classList.add(
      "press"
    );


    const tau =
      Number(
        result.tau ??
        result.threshold ??
        result.bestTau
      );


    state.tau =
      Number.isFinite(tau)
        ? tau
        : 1.01;


    state.certification =
      result;


    if (detail) {

      const n =
        result.n ??
        state.cal.length;


      const failures =
        result.failures ??
        result.k ??
        0;


      const risk =
        result.risk ??
        result.empiricalRisk ??
        0;


      const p =
        result.pValue ??
        result.p ??
        0;


      const delta =
        result.delta ??
        0.05;


      detail.textContent =
        `τ = ${state.tau.toFixed(2)} · ` +
        `n = ${n} · ` +
        `failures = ${failures} · ` +
        `risk = ${Number(risk).toFixed(3)} · ` +
        `p = ${Number(p).toFixed(3)} · ` +
        `δ = ${delta}`;
    }
  }


  // ============================================================
  // STAT TILES
  // ============================================================

  function updateTiles(result) {

    if (!result) {
      return;
    }


    const costSaved =
      value(
        result,
        [
          "costSavedPercent",
          "costSaved",
          "savingsPercent"
        ]
      );


    const cheap =
      value(
        result,
        [
          "cheapPercent",
          "cheapTraffic",
          "cheapPct"
        ]
      );


    let regression =
      value(
        result,
        [
          "regressionPercent",
          "qualityRegression"
        ],
        NaN
      );


    if (!Number.isFinite(regression)) {

      regression =
        value(
          result,
          ["regression"],
          0
        );


      // Router values are normally decimal.
      regression *= 100;
    }


    const overhead =
      value(
        result,
        [
          "overheadPercent",
          "overhead"
        ]
      );


    if ($("stat-cost-saved")) {

      $("stat-cost-saved")
        .textContent =
        pct(costSaved);
    }


    if ($("stat-cheap-traffic")) {

      $("stat-cheap-traffic")
        .textContent =
        pct(cheap);
    }


    if ($("stat-regression")) {

      $("stat-regression")
        .textContent =
        pct(regression);
    }


    if ($("stat-overhead")) {

      $("stat-overhead")
        .textContent =
        pct(overhead);
    }
  }


  // ============================================================
  // ROUTING FLOW
  // ============================================================

  function updateFlow(
    result,
    rows
  ) {

    if (!result) {
      return;
    }


    const n =
      Math.max(
        1,
        rows.length
      );


    const cache =
  value(
    result,
    ["cacheHitPercent"],
    0
  );

const cheap =
  value(
    result,
    ["cheapAcceptedPercent"],
    0
  );

const escalated =
  value(
    result,
    ["escalatedPercent"],
    0
  );

const frontier =
  value(
    result,
    ["frontierPercent"],
    0
  );


    function flowPercent(x) {

      // Already a percentage.
      if (x > 1) {
        return x;
      }

      // Decimal fraction.
      if (x > 0) {
        return x * 100;
      }

      return 0;
    }


    function set(id, x) {

      const element =
        $(id);

      if (element) {
        element.textContent =
          pct(x);
      }
    }


    set(
      "flow-cache",
      flowPercent(
        cache
      )
    );


    set(
      "flow-cheap",
      flowPercent(
        cheap
      )
    );


    set(
      "flow-escalated",
      flowPercent(
        escalated
      )
    );


    set(
      "flow-frontier",
      flowPercent(
        frontier
      )
    );
  }


  // ============================================================
  // BASELINES
  // ============================================================

  function baselinePoints() {

    const rows =
      state.test;


    if (!rows.length) {
      return [];
    }


    const lengths =
      rows
        .map(queryLength)
        .sort(
          (a, b) => a - b
        );


    const median =
      lengths[
        Math.floor(
          lengths.length / 2
        )
      ];


    const policies = [

      {
        name: "Always Cheap",

        choose: () =>
          "cheap"
      },

      {
        name: "Always Frontier",

        choose: () =>
          "frontier"
      },

      {
        name: "Random 50/50",

        choose: (_, index) =>
          index % 2 === 0
            ? "cheap"
            : "frontier"
      },

      {
        name: "Length Heuristic",

        choose: row =>
          queryLength(row) <= median
            ? "cheap"
            : "frontier"
      },

      {
        name: "Fixed p-hat = 0.7",

        choose: row =>
          Number(row.phat || 0) >= 0.7
            ? "cheap"
            : "frontier"
      }
    ];


    return policies.map(
      policy => {

        const result =
          directPolicy(
            rows,
            policy.choose
          );


        return {

          name: policy.name,

          x: result.cost,

          y: result.accuracy,

          cost: result.cost,

          accuracy:
            result.accuracy
        };
      }
    );
  }


  // ============================================================
  // WARRANTY AT A PARTICULAR EPSILON
  // ============================================================

  function oursAtEpsilon(eps) {

    const previousEps =
      state.eps;


    const previousTau =
      state.tau;


    state.eps =
      Number(eps);


    let cert =
      null;


    try {

      cert =
        certification();

    } catch (error) {

      console.error(
        "WARRANTY epsilon certification error:",
        error
      );

      cert = null;
    }


    const tau =
      cert
        ? Number(cert.tau)
        : 1.01;


    const result =
      routerSim(
        state.test,
        tau,
        {
          verify: false,
          cache: false
        }
      );


    // Restore UI state.
    state.eps =
      previousEps;


    state.tau =
      previousTau;


    return {

      x:
        value(
          result,
          ["cost", "avgCost"]
        ),

      y:
        value(
          result,
          ["accuracy"]
        ),

      accuracy:
        value(
          result,
          ["accuracy"]
        ),

      cost:
        value(
          result,
          ["cost", "avgCost"]
        ),

      eps:
        Number(eps),

      certified:
        Boolean(cert)
    };
  }


  // ============================================================
  // WARRANTY CURVE
  // ============================================================

  function buildCurve() {

    const curve = [];


    for (
      let eps = 1;
      eps <= 25;
      eps += 2
    ) {

      curve.push(
        oursAtEpsilon(eps)
      );
    }


    // Make sure 25% is always included.
    if (
      !curve.some(
        point => point.eps === 25
      )
    ) {

      curve.push(
        oursAtEpsilon(25)
      );
    }


    return curve;
  }


  // ============================================================
  // PARETO
  // ============================================================

  function updatePareto(current) {

    if (
      window.Charts &&
      typeof Charts.updatePareto ===
        "function"
    ) {

      Charts.updatePareto(
        state.warrantyCurve,
        state.baselines,
        current
      );
    }
  }


  // ============================================================
  // ABLATION
  // ============================================================

  function updateAblation() {

    const body =
      $("ablationBody");


    if (!body) {
      return;
    }


    const rows =
      state.test;


    body.innerHTML = "";


    if (!rows.length) {
      return;
    }


    const lengths =
      rows
        .map(queryLength)
        .sort(
          (a, b) => a - b
        );


    const median =
      lengths[
        Math.floor(
          lengths.length / 2
        )
      ];


    const policies = [

      [
        "Always Frontier",
        () => "frontier"
      ],

      [
        "Always Cheap",
        () => "cheap"
      ],

      [
        "Random 50/50",
        (_, i) =>
          i % 2 === 0
            ? "cheap"
            : "frontier"
      ],

      [
        "Length Heuristic",
        row =>
          queryLength(row) <= median
            ? "cheap"
            : "frontier"
      ],

      [
        "Fixed p-hat = 0.7",
        row =>
          Number(row.phat || 0) >= 0.7
            ? "cheap"
            : "frontier"
      ]
    ];


    // ----------------------------------------------------------
    // WARRANTY
    // ----------------------------------------------------------

    policies.push([
      "WARRANTY",

      row =>
        Number(row.phat || 0) >= state.tau
          ? "cheap"
          : "frontier"
    ]);


    policies.forEach(
      ([name, choose]) => {

        const result =
          directPolicy(
            rows,
            choose
          );


        addRow(
          name,
          result
        );
      }
    );


    // ----------------------------------------------------------
    // VERIFY
    // ----------------------------------------------------------

    if (
      state.certification &&
      Number.isFinite(state.tau)
    ) {

      const verify =
        routerSim(
          rows,
          state.tau,
          {
            verify: true,
            cache: false,
            tau2: 0.5
          }
        );


      const verifyCache =
        routerSim(
          rows,
          state.tau,
          {
            verify: true,
            cache: true,
            tau2: 0.5
          }
        );


      addRow(
        "WARRANTY + Verify",
        verify
      );


      addRow(
        "WARRANTY + Verify + Cache",
        verifyCache
      );
    }
  }


  function addRow(
    name,
    result
  ) {

    const body =
      $("ablationBody");


    if (!body) {
      return;
    }


    const accuracy =
      value(
        result,
        ["accuracy"]
      );


    const costValue =
      value(
        result,
        [
          "cost",
          "avgCost"
        ]
      );


    const regret =
      value(
        result,
        [
          "regret",
          "regretPercent"
        ]
      );


    const row =
      document.createElement(
        "div"
      );


    row.className =
      "grid grid-cols-4 px-1 py-1 rounded hover:bg-slate-800";


    row.innerHTML = `
      <span>${name}</span>
      <span>${(accuracy * 100).toFixed(1)}%</span>
      <span>${money(costValue)}</span>
      <span>${(regret * 100).toFixed(1)}%</span>
    `;


    body.appendChild(row);
  }


  // ============================================================
  // PREPARE PHAT
  // ============================================================

  function preparePHAT() {

    if (
      !window.Router ||
      typeof window.Router.predictPHat !==
      "function"
    ) {

      throw new Error(
        "Router.predictPHat() is not available."
      );
    }


    const rows = [
      ...state.cal,
      ...state.test
    ];


    rows.forEach(row => {

      const prediction =
        Number(
          Router.predictPHat(
            row,
            state.train,
            20
          )
        );


      row.phat =
        Number.isFinite(prediction)
          ? clamp01(prediction)
          : 0;
    });


    console.log(
      "WARRANTY p-hat prepared:",
      {
        calibration:
          state.cal.map(
            r => r.phat
          ),

        test:
          state.test.map(
            r => r.phat
          )
      }
    );
  }


  // ============================================================
  // RENDER
  // ============================================================

  async function render() {

    const slider =
      $("epsSlider");


    state.eps =
      Number(
        slider?.value ?? state.eps
      );


    if (
      !Number.isFinite(
        state.eps
      )
    ) {

      state.eps = 8;
    }


    state.eps =
      Math.max(
        0,
        Math.min(
          25,
          state.eps
        )
      );


    if ($("epsValue")) {

      $("epsValue")
        .textContent =
        state.eps + "%";
    }


    // ----------------------------------------------------------
    // Certification
    // ----------------------------------------------------------

    const cert =
      certification();


    state.certification =
      cert;


    updateStamp(
      cert
    );


    // ----------------------------------------------------------
    // Routing
    //
    // If certified:
    // use certified tau.
    //
    // If refused:
    // tau = 1.01, meaning no normal p-hat
    // should route to cheap.
    // ----------------------------------------------------------

    const tau =
      cert
        ? Number(cert.tau)
        : 1.01;


    state.tau =
      Number.isFinite(tau)
        ? tau
        : 1.01;


    const result =
      routerSim(
        state.test,
        state.tau,
        {
          verify: true,
          cache: true,
          tau2: 0.5
        }
      );


    // ----------------------------------------------------------
    // Dashboard
    // ----------------------------------------------------------

    updateTiles(
      result
    );


    updateFlow(
      result,
      state.test
    );


    updateAblation();


    // ----------------------------------------------------------
    // Current Pareto point
    // ----------------------------------------------------------

    state.current = {

      x:
        value(
          result,
          [
            "cost",
            "avgCost"
          ]
        ),

      y:
        value(
          result,
          ["accuracy"]
        ),

      accuracy:
        value(
          result,
          ["accuracy"]
        ),

      cost:
        value(
          result,
          [
            "cost",
            "avgCost"
          ]
        ),

      eps:
        state.eps
    };


    updatePareto(
      state.current
    );


    console.log(
      "WARRANTY render:",
      {
        eps: state.eps,
        certified: Boolean(cert),
        tau: state.tau,
        result
      }
    );
  }


  // ============================================================
  // INITIALIZATION
  // ============================================================

  async function init() {

    try {

      console.log(
        "WARRANTY: initializing C8..."
      );


      // --------------------------------------------------------
      // Load benchmark.
      // --------------------------------------------------------

      const bank =
        await loadJSON(
          "data/bank.json",
          "data/bank.sample.json"
        );


      const rows =
        rowsFrom(bank);


      if (!rows.length) {

        throw new Error(
          "No benchmark rows found."
        );
      }


      // --------------------------------------------------------
      // Load prices.
      // --------------------------------------------------------

      let prices =
        null;


      try {

        prices =
          await loadJSON(
            "data/prices.json"
          );

      } catch (_) {

        console.warn(
          "WARRANTY: prices.json not found; using defaults."
        );
      }


      state.prices =
        prices ||
        DEFAULT_PRICES;


      // --------------------------------------------------------
      // Split dataset.
      // --------------------------------------------------------

      const parts =
        split(rows);


      state.train =
        parts.train;

      state.cal =
        parts.cal;

      state.test =
        parts.test;


      console.log(
        "WARRANTY dataset:",
        {
          total: rows.length,
          train: state.train.length,
          cal: state.cal.length,
          test: state.test.length
        }
      );


      if (
        !state.train.length ||
        !state.cal.length ||
        !state.test.length
      ) {

        throw new Error(
          "Dataset must contain train, cal and test rows."
        );
      }


      // --------------------------------------------------------
      // Generate p-hat.
      // --------------------------------------------------------

      preparePHAT();


      // --------------------------------------------------------
      // Baselines.
      // --------------------------------------------------------

      state.baselines =
        baselinePoints();


      // --------------------------------------------------------
      // Warranty curve.
      // --------------------------------------------------------

      state.warrantyCurve =
        buildCurve();


      // --------------------------------------------------------
      // Chart.
      // --------------------------------------------------------

      if (
        window.Charts &&
        typeof Charts.initPareto ===
          "function"
      ) {

        Charts.initPareto();
      }


      // --------------------------------------------------------
      // First render.
      // --------------------------------------------------------

      await render();


      console.log(
        "WARRANTY C8 ready",
        {
          train:
            state.train.length,

          calibration:
            state.cal.length,

          test:
            state.test.length,

          epsilon:
            state.eps,

          tau:
            state.tau
        }
      );

    } catch (error) {

      console.error(
        "WARRANTY UI error:",
        error
      );


      const stamp =
        $("certStamp");

      const detail =
        $("stampDetail");


      if (stamp) {

        stamp.textContent =
          "✕ ERROR";


        stamp.className =
          "px-4 py-1.5 rounded-full border border-red-500 text-red-400 text-sm font-medium";
      }


      if (detail) {

        detail.textContent =
          "Frontend error: " +
          error.message;
      }
    }
  }


  // ============================================================
  // PUBLIC DEBUG STATE
  // ============================================================

  function expose() {

    window.UI = {

      getState() {

        return {

          eps:
            state.eps,

          tau:
            state.tau,

          certification:
            state.certification,

          train:
            state.train,

          cal:
            state.cal,

          test:
            state.test,

          prices:
            state.prices,

          baselines:
            state.baselines,

          warrantyCurve:
            state.warrantyCurve,

          current:
            state.current
        };
      },


      certifyNow() {

        return certification();
      },


      renderNow() {

        return render();
      }
    };
  }


  // ============================================================
  // DOM READY
  // ============================================================

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      expose();


      const slider =
        $("epsSlider");


      if (slider) {

        slider.addEventListener(
          "input",
          async () => {

            state.eps =
              Number(
                slider.value
              );


            if ($("epsValue")) {

              $("epsValue")
                .textContent =
                state.eps + "%";
            }


            await render();
          }
        );
      }


      init();
    }
  );

})();