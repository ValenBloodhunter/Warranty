// WARRANTY — C8 UI WIRING
// Commit: Add routing baselines

(() => {
  "use strict";

  const DEFAULT_PRICES = {
    cheap: { input: 0.15, output: 0.60 },
    frontier: { input: 5.00, output: 15.00 }
  };

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
    current: null
  };

  async function loadJSON(primary, fallback) {
    try {
      const r = await fetch(primary);
      if (!r.ok) throw new Error("not found");
      return await r.json();
    } catch (_) {
      if (!fallback) return null;
      const r = await fetch(fallback);
      if (!r.ok) throw new Error("fallback not found");
      return await r.json();
    }
  }

  function rowsFrom(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.rows)) return data.rows;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  }

  function split(rows) {
    return {
      train: rows.filter(r => r.split === "train"),
      cal: rows.filter(r => r.split === "cal"),
      test: rows.filter(r => r.split === "test")
    };
  }

  function money(n) {
    return "$" + Number(n || 0).toFixed(3);
  }

  function pct(n) {
    return Number(n || 0).toFixed(1) + "%";
  }

  function value(obj, keys, fallback = 0) {
    for (const k of keys) {
      if (obj && Number.isFinite(Number(obj[k]))) return Number(obj[k]);
    }
    return fallback;
  }

  function cheapCorrect(r) {
    return !!(
      r.cheap_correct ??
      r.cheap?.correct ??
      r.cheap?.is_correct
    );
  }

  function frontierCorrect(r) {
    return !!(
      r.frontier_correct ??
      r.frontier?.correct ??
      r.frontier?.is_correct
    );
  }

  function queryLength(r) {
    return String(r.query || "").length;
  }

  function cost(r, which) {
    if (window.Router && typeof Router.costOf === "function") {
      return Number(Router.costOf(r, which, state.prices)) || 0;
    }

    const p = state.prices[which] || DEFAULT_PRICES[which];
    const input = Number(
      r[which]?.input_tokens ??
      r.input_tokens ??
      100
    );

    const output = Number(
      r[which]?.output_tokens ??
      r.output_tokens ??
      50
    );

    return input / 1e6 * p.input + output / 1e6 * p.output;
  }

  function directPolicy(rows, choose) {
    let totalCost = 0;
    let correct = 0;
    let regret = 0;

    rows.forEach(r => {
      const route = choose(r);
      const ok = route === "cheap"
        ? cheapCorrect(r)
        : frontierCorrect(r);

      if (ok) correct++;

      if (!ok && frontierCorrect(r)) regret++;

      totalCost += cost(r, route);
    });

    const n = Math.max(1, rows.length);
    const accuracy = correct / n;
    const frontierCost =
      rows.reduce((s, r) => s + cost(r, "frontier"), 0) / n;

    return {
      accuracy,
      cost: totalCost / n,
      regret: regret / n,
      regression: Math.max(0, 1 - accuracy),
      cheapPercent:
        rows.filter(r => choose(r) === "cheap").length / n * 100,
      costSaved:
        frontierCost > 0
          ? (1 - (totalCost / n) / frontierCost) * 100
          : 0
    };
  }

  function routerSim(rows, tau, options) {
    if (!window.Router || typeof Router.simulate !== "function") {
      return directPolicy(
        rows,
        r => Number(r.phat || 0) >= tau ? "cheap" : "frontier"
      );
    }

    return Router.simulate(rows, tau, state.prices, options || {});
  }

  function certification() {
    const scores = state.cal.map(r => Number(r.phat || 0));
    const losses = state.cal.map(r =>
      window.Router.lossIfCheap(r)
    );

    if (typeof window.certify !== "function") {
      throw new Error("certify() was not found in certify.js");
    }

    return window.certify(
      scores,
      losses,
      state.eps / 100,
      0.05
    );
  }

  function updateStamp(result) {
    const stamp = $("certStamp");
    const detail = $("stampDetail");

    if (!stamp) return;

    stamp.classList.remove("press");

    if (!result) {
      stamp.textContent =
        "✕ REFUSED — ROUTING 100% TO FRONTIER";

      stamp.className =
        "px-4 py-1.5 rounded-full border border-red-500 text-red-400 text-sm font-medium";

      if (detail) {
        detail.textContent =
          "No threshold passes · routing 100% to frontier · δ = 0.05";
      }

      state.tau = 1.01;
      return;
    }

    stamp.textContent = "✓ CERTIFIED";

    stamp.className =
      "px-4 py-1.5 rounded-full border border-green-500 text-green-400 text-sm font-medium";

    void stamp.offsetWidth;
    stamp.classList.add("press");

    state.tau = Number(
      result.tau ??
      result.threshold ??
      result.bestTau ??
      1.01
    );

    if (detail) {
      const n = result.n ?? state.cal.length;
      const failures = result.failures ?? result.k ?? 0;
      const risk = result.empiricalRisk ?? result.risk ?? 0;
      const p = result.pValue ?? result.p ?? 0;
      const delta = result.delta ?? 0.05;

      detail.textContent =
        `τ = ${state.tau.toFixed(2)} · ` +
        `n = ${n} · ` +
        `failures = ${failures} · ` +
        `risk = ${Number(risk).toFixed(3)} · ` +
        `p = ${Number(p).toFixed(3)} · ` +
        `δ = ${delta}`;
    }
  }

  function updateTiles(result) {
    const costSaved = value(result, [
      "costSavedPercent",
      "costSaved",
      "savingsPercent"
    ]);

    const cheap = value(result, [
      "cheapPercent",
      "cheapTraffic",
      "cheapPct"
    ]);

    const regression = value(result, [
      "regressionPercent",
      "regression",
      "qualityRegression"
    ]) * (value(result, [
      "regressionPercent",
      "qualityRegression"
    ], 0) === 0 ? 100 : 1);

    const overhead = value(result, [
      "overheadPercent",
      "overhead"
    ]);

    if ($("stat-cost-saved"))
      $("stat-cost-saved").textContent = pct(costSaved);

    if ($("stat-cheap-traffic"))
      $("stat-cheap-traffic").textContent = pct(cheap);

    if ($("stat-regression"))
      $("stat-regression").textContent = pct(regression);

    if ($("stat-overhead"))
      $("stat-overhead").textContent = pct(overhead);
  }

  function updateFlow(result, rows) {
    const n = Math.max(1, rows.length);

    const cache = value(result, [
      "cacheHits",
      "cacheHitPercent"
    ]);

    const cheap = value(result, [
      "cheapAccepted",
      "cheapPercent"
    ]);

    const escalated = value(result, [
      "escalated",
      "escalatedPercent"
    ]);

    const frontier = value(result, [
      "frontier",
      "frontierPercent"
    ]);

    const set = (id, x) => {
      if ($(id)) $(id).textContent = pct(x);
    };

    set("flow-cache",
      cache > 1 ? cache : cache / n * 100
    );

    set("flow-cheap",
      cheap > 1 ? cheap : cheap / n * 100
    );

    set("flow-escalated",
      escalated > 1 ? escalated : escalated / n * 100
    );

    set("flow-frontier",
      frontier > 1 ? frontier : frontier / n * 100
    );
  }

  function baselinePoints() {
    const rows = state.test;
    if (!rows.length) return [];

    const lengths = rows
      .map(queryLength)
      .sort((a, b) => a - b);

    const median =
      lengths[Math.floor(lengths.length / 2)];

    const policies = [
      {
        name: "Always Cheap",
        choose: () => "cheap"
      },
      {
        name: "Always Frontier",
        choose: () => "frontier"
      },
      {
        name: "Random 50/50",
        choose: (_, i) =>
          i % 2 === 0 ? "cheap" : "frontier"
      },
      {
        name: "Length Heuristic",
        choose: r =>
          queryLength(r) <= median ? "cheap" : "frontier"
      },
      {
        name: "Fixed p-hat = 0.7",
        choose: r =>
          Number(r.phat || 0) >= 0.7
            ? "cheap"
            : "frontier"
      }
    ];

    return policies.map(p => {
      const result = directPolicy(
        rows,
        (r, i) => p.choose(r, i)
      );

      return {
        name: p.name,
        x: result.cost,
        y: result.accuracy,
        cost: result.cost,
        accuracy: result.accuracy
      };
    });
  }

  function oursAtEpsilon(eps) {
    const old = state.eps;
    state.eps = eps;

    let cert = null;

    try {
      cert = certification();
    } catch (_) {
      cert = null;
    }

    const tau = cert
      ? Number(
          cert.tau ??
          cert.threshold ??
          cert.bestTau ??
          1.01
        )
      : 1.01;

    const result = routerSim(
      state.test,
      tau,
      { verify: false, cache: false }
    );

    state.eps = old;

    return {
      x: value(result, ["cost", "avgCost"]),
      y: value(result, ["accuracy"]),
      accuracy: value(result, ["accuracy"]),
      cost: value(result, ["cost", "avgCost"]),
      eps
    };
  }

  function buildCurve() {
    const curve = [];

    for (let eps = 1; eps <= 25; eps += 2) {
      curve.push(oursAtEpsilon(eps));
    }

    return curve;
  }

  function updatePareto(current) {
    if (
      window.Charts &&
      typeof Charts.updatePareto === "function"
    ) {
      Charts.updatePareto(
        state.warrantyCurve,
        state.baselines,
        current
      );
    }
  }

  function updateAblation() {
    const body = $("ablationBody");
    if (!body) return;

    const rows = state.test;
    body.innerHTML = "";

    const lengthMedian =
      rows.map(queryLength)
        .sort((a, b) => a - b)[
          Math.floor(rows.length / 2)
        ];

    const policies = [
      ["Always Frontier", r => "frontier"],
      ["Always Cheap", r => "cheap"],
      ["Random 50/50", (r, i) =>
        i % 2 === 0 ? "cheap" : "frontier"
      ],
      ["Length Heuristic", r =>
        queryLength(r) <= lengthMedian
          ? "cheap"
          : "frontier"
      ],
      ["Fixed p-hat = 0.7", r =>
        Number(r.phat || 0) >= 0.7
          ? "cheap"
          : "frontier"
      ]
    ];

    policies.push([
      "WARRANTY",
      r => Number(r.phat || 0) >= state.tau
        ? "cheap"
        : "frontier"
    ]);

    policies.forEach(([name, choose]) => {
      const r = directPolicy(rows, choose);
      addRow(name, r);
    });

    const verify = routerSim(
      rows,
      state.tau,
      { verify: true, cache: false, tau2: 0.5 }
    );

    const verifyCache = routerSim(
      rows,
      state.tau,
      { verify: true, cache: true, tau2: 0.5 }
    );

    addRow("WARRANTY + Verify", verify);
    addRow("WARRANTY + Verify + Cache", verifyCache);
  }

  function addRow(name, result) {
    const body = $("ablationBody");
    if (!body) return;

    const accuracy = value(result, ["accuracy"]);
    const costValue = value(result, ["cost", "avgCost"]);
    const regret = value(result, [
      "regret",
      "regretPercent"
    ]);

    const row = document.createElement("div");

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

  async function init() {
    try {
      const bank = await loadJSON(
        "data/bank.json",
        "data/bank.sample.json"
      );

      const prices =
        await loadJSON("data/prices.json", null);

      const rows = rowsFrom(bank);

      if (!rows.length) {
        throw new Error("No benchmark rows found.");
      }

      state.prices =
        prices || DEFAULT_PRICES;

      const parts = split(rows);

      state.train = parts.train;
      state.cal = parts.cal;
      state.test = parts.test;

      if (!state.train.length ||
          !state.cal.length ||
          !state.test.length) {
        throw new Error(
          "Dataset must contain train, cal and test rows."
        );
      }

      [...state.cal, ...state.test].forEach(row => {
        row.phat = Number(
          Router.predictPHAT(
            row,
            state.train,
            20
          )
        );
      });

      state.baselines = baselinePoints();
      state.warrantyCurve = buildCurve();

      if (
        window.Charts &&
        typeof Charts.initPareto === "function"
      ) {
        Charts.initPareto();
      }

      await render();

      console.log(
        "WARRANTY C8 ready:",
        state.test.length,
        "test rows"
      );

    } catch (err) {
      console.error("WARRANTY UI error:", err);

      const detail = $("stampDetail");

      if (detail) {
        detail.textContent =
          "Frontend error: " + err.message;
      }

      if ($("certStamp")) {
        $("certStamp").textContent = "✕ ERROR";
        $("certStamp").className =
          "px-4 py-1.5 rounded-full border border-red-500 text-red-400 text-sm font-medium";
      }
    }
  }

  async function render() {
    state.eps =
      Number($("epsSlider")?.value ?? 8);

    if ($("epsValue")) {
      $("epsValue").textContent =
        state.eps + "%";
    }

    let cert = null;

    try {
      cert = certification();
    } catch (err) {
      console.error(err);
    }

    updateStamp(cert);

    const result = routerSim(
      state.test,
      state.tau,
      { verify: true, cache: true, tau2: 0.5 }
    );

    updateTiles(result);
    updateFlow(result, state.test);
    updateAblation();

    state.current = {
      x: value(result, ["cost", "avgCost"]),
      y: value(result, ["accuracy"]),
      accuracy: value(result, ["accuracy"]),
      cost: value(result, ["cost", "avgCost"]),
      eps: state.eps
    };

    updatePareto(state.current);
  }

  function expose() {
    window.UI = {
      getState() {
        return {
          tau: state.tau,
          eps: state.eps,
          test: state.test,
          train: state.train,
          prices: state.prices
        };
      }
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    expose();

    const slider = $("epsSlider");

    if (slider) {
      slider.addEventListener("input", async () => {
        state.eps = Number(slider.value);

        if ($("epsValue")) {
          $("epsValue").textContent =
            state.eps + "%";
        }

        await render();
      });
    }

    init();
  });
})();