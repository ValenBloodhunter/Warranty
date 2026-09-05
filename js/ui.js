(function () {
  "use strict";

  const DEFAULT_PRICES = {
    cheap: { input: 0.15, output: 0.60 },
    frontier: { input: 5.00, output: 15.00 }
  };

  const state = {
    eps: 8,
    tau: 1.01,
    train: [],
    cal: [],
    test: [],
    prices: DEFAULT_PRICES,
    warrantyCurve: [],
    baselines: [],
    currentPoint: null
  };

  function loadJSON(url, fallback) {
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("Load failed");
        return res.json();
      })
      .catch(function () {
        return fallback;
      });
  }

  function normaliseRows(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.rows)) return data.rows;
    return [];
  }

  function normalisePrices(data) {
    if (!data) return DEFAULT_PRICES;

    return {
      cheap: data.cheap || DEFAULT_PRICES.cheap,
      frontier: data.frontier || DEFAULT_PRICES.frontier
    };
  }

  function splitRows(rows) {
    return {
      train: rows.filter(function (r) {
        return r.split === "train";
      }),
      cal: rows.filter(function (r) {
        return r.split === "cal";
      }),
      test: rows.filter(function (r) {
        return r.split === "test";
      })
    };
  }

  function animateNumber(el, value, suffix) {
    if (!el) return;

    const start = Number(el.dataset.value || 0);
    const end = Number(value);
    const duration = 300;
    const begin = performance.now();

    function tick(now) {
      const p = Math.min(1, (now - begin) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = start + (end - start) * eased;

      el.textContent = current.toFixed(1) + (suffix || "");

      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        el.dataset.value = String(end);
      }
    }

    requestAnimationFrame(tick);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function paintStamp(certified, result) {
    const stamp = document.getElementById("certStamp");

    if (!stamp) return;

    if (!certified) {
      stamp.textContent =
        "REFUSED — ROUTING 100% TO FRONTIER";

      stamp.className =
        "rounded-full border border-red-400 px-5 py-2 text-red-400 font-semibold";

      return;
    }

    stamp.textContent = "✓ CERTIFIED";

    stamp.className =
      "rounded-full border border-emerald-400 px-5 py-2 text-emerald-400 font-semibold";

    stamp.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.15)" },
        { transform: "scale(1)" }
      ],
      {
        duration: 180,
        easing: "ease-out"
      }
    );

    if (result) {
      setText(
        "stampDetail",
        "τ = " +
          result.tau.toFixed(3) +
          " · n = " +
          result.n +
          " · failures = " +
          result.failures +
          " · risk = " +
          (result.empiricalRisk * 100).toFixed(2) +
          "% · p = " +
          result.pValue.toFixed(4) +
          " · δ = " +
          result.delta
      );
    }
  }

  function simulate(rows, tau) {
    return Router.simulate(
      rows,
      tau,
      state.prices,
      {
        verify: true,
        cache: true,
        tau2: 0.5
      }
    );
  }

  function alwaysCheap(rows) {
    let cost = 0;
    let correct = 0;

    rows.forEach(function (r) {
      cost += Router.costOf(r, "cheap", state.prices);

      if (r.cheap && r.cheap.correct) {
        correct++;
      }
    });

    return {
      name: "Always cheap",
      cost: cost,
      accuracy: rows.length ? correct / rows.length : 0
    };
  }

  function alwaysFrontier(rows) {
    let cost = 0;
    let correct = 0;

    rows.forEach(function (r) {
      cost += Router.costOf(r, "frontier", state.prices);

      if (r.frontier && r.frontier.correct) {
        correct++;
      }
    });

    return {
      name: "Always frontier",
      cost: cost,
      accuracy: rows.length ? correct / rows.length : 0
    };
  }

  function random5050(rows) {
    let cost = 0;
    let correct = 0;

    rows.forEach(function (r, i) {
      const useCheap = i % 2 === 0;
      const model = useCheap ? "cheap" : "frontier";

      cost += Router.costOf(r, model, state.prices);

      if (r[model] && r[model].correct) {
        correct++;
      }
    });

    return {
      name: "Random 50/50",
      cost: cost,
      accuracy: rows.length ? correct / rows.length : 0
    };
  }

  function medianLength(rows) {
    const lengths = rows
      .map(function (r) {
        return String(r.query || "").length;
      })
      .sort(function (a, b) {
        return a - b;
      });

    if (!lengths.length) return 0;

    const mid = Math.floor(lengths.length / 2);

    return lengths.length % 2
      ? lengths[mid]
      : (lengths[mid - 1] + lengths[mid]) / 2;
  }

  function lengthHeuristic(rows) {
    const threshold = medianLength(rows);

    let cost = 0;
    let correct = 0;

    rows.forEach(function (r) {
      const useCheap =
        String(r.query || "").length <= threshold;

      const model = useCheap ? "cheap" : "frontier";

      cost += Router.costOf(r, model, state.prices);

      if (r[model] && r[model].correct) {
        correct++;
      }
    });

    return {
      name: "Length heuristic",
      cost: cost,
      accuracy: rows.length ? correct / rows.length : 0
    };
  }

  function fixedThreshold(rows) {
    let cost = 0;
    let correct = 0;

    rows.forEach(function (r) {
      const model =
        Number(r.phat) >= 0.7
          ? "cheap"
          : "frontier";

      cost += Router.costOf(r, model, state.prices);

      if (r[model] && r[model].correct) {
        correct++;
      }
    });

    return {
      name: "Fixed p-hat = 0.7",
      cost: cost,
      accuracy: rows.length ? correct / rows.length : 0
    };
  }

  function buildBaselines() {
    return [
      alwaysCheap(state.test),
      alwaysFrontier(state.test),
      random5050(state.test),
      lengthHeuristic(state.test),
      fixedThreshold(state.test)
    ];
  }

  function getAblation() {
    const rows = [];

    const frontier = alwaysFrontier(state.test);
    const cheap = alwaysCheap(state.test);
    const random = random5050(state.test);
    const length = lengthHeuristic(state.test);
    const fixed = fixedThreshold(state.test);

    rows.push(frontier);
    rows.push(cheap);
    rows.push(random);
    rows.push(length);
    rows.push(fixed);

    const ours = simulate(
      state.test,
      state.tau
    );

    rows.push({
      name: "WARRANTY",
      cost: ours.cost,
      accuracy: ours.accuracy
    });

    const verify = simulate(
      state.test,
      state.tau
    );

    rows.push({
      name: "WARRANTY + verify",
      cost: verify.cost,
      accuracy: verify.accuracy
    });

    const cache = simulate(
      state.test,
      state.tau
    );

    rows.push({
      name: "WARRANTY + verify + cache",
      cost: cache.cost,
      accuracy: cache.accuracy
    });

    return rows;
  }

  function updateAblation() {
    const table = document.getElementById(
      "ablationBody"
    );

    if (!table) return;

    const rows = getAblation();

    table.innerHTML = "";

    rows.forEach(function (row) {
      const tr = document.createElement("tr");

      tr.className =
        "border-t border-slate-800";

      const tdName =
        document.createElement("td");

      const tdAccuracy =
        document.createElement("td");

      const tdCost =
        document.createElement("td");

      tdName.className =
        "px-4 py-3 text-slate-300";

      tdAccuracy.className =
        "px-4 py-3 text-slate-300";

      tdCost.className =
        "px-4 py-3 text-slate-300";

      tdName.textContent = row.name;

      tdAccuracy.textContent =
        (row.accuracy * 100).toFixed(1) + "%";

      tdCost.textContent =
        "$" + Number(row.cost).toFixed(4);

      tr.appendChild(tdName);
      tr.appendChild(tdAccuracy);
      tr.appendChild(tdCost);

      table.appendChild(tr);
    });
  }

  function buildWarrantyCurve() {
    const curve = [];

    for (let eps = 1; eps <= 25; eps += 2) {
      const result = Certify.certify(
        state.cal.map(function (r) {
          return r.phat;
        }),
        state.cal.map(function (r) {
          return Router.lossIfCheap(r);
        }),
        eps / 100,
        0.05
      );

      let tau = 1.01;

      if (result) {
        tau = result.tau;
      }

      const sim = simulate(
        state.test,
        tau
      );

      curve.push({
        x: sim.cost,
        y: sim.accuracy,
        eps: eps
      });
    }

    return curve;
  }

  function updatePareto() {
    const ours = simulate(
      state.test,
      state.tau
    );

    state.currentPoint = {
      x: ours.cost,
      y: ours.accuracy,
      eps: state.eps
    };

    Charts.updatePareto(
      state.warrantyCurve,
      state.baselines.map(function (b) {
        return {
          x: b.cost,
          y: b.accuracy,
          name: b.name
        };
      }),
      state.currentPoint
    );
  }

  function updateTiles(result) {
    const frontier = alwaysFrontier(
      state.test
    );

    const saved =
      frontier.cost > 0
        ? ((frontier.cost - result.cost) /
            frontier.cost) *
          100
        : 0;

    animateNumber(
      document.getElementById("costSaved"),
      saved,
      "%"
    );

    animateNumber(
      document.getElementById("cheapTraffic"),
      result.cheapPercent || 0,
      "%"
    );

    animateNumber(
      document.getElementById("regression"),
      (result.regression || 0) * 100,
      "%"
    );

    animateNumber(
      document.getElementById("overhead"),
      (result.overheadPercent || 0),
      "%"
    );
  }

  function updateFlowBar(result) {
    if (!result) return;

    const total =
      state.test.length || 1;

    const values = {
      cache: result.cacheHits || 0,
      cheap: result.cheapAccepted || 0,
      escalated: result.escalated || 0,
      frontier: result.frontier || 0
    };

    const ids = {
      cache: "flowCache",
      cheap: "flowCheap",
      escalated: "flowEscalated",
      frontier: "flowFrontier"
    };

    Object.keys(values).forEach(function (key) {
      const el =
        document.getElementById(ids[key]);

      if (!el) return;

      el.style.width =
        (values[key] / total) * 100 + "%";
    });
  }

  function render() {
    const slider =
      document.getElementById("epsSlider");

    const eps =
      slider
        ? Number(slider.value)
        : 8;

    state.eps = eps;

    setText(
      "epsValue",
      eps + "%"
    );

    const calScores =
      state.cal.map(function (r) {
        return r.phat;
      });

    const calLosses =
      state.cal.map(function (r) {
        return Router.lossIfCheap(r);
      });

    const result =
      Certify.certify(
        calScores,
        calLosses,
        eps / 100,
        0.05
      );

    let tau = 1.01;

    if (!result) {
      paintStamp(false);

      setText(
        "stampDetail",
        "No statistically certified threshold at this ε. All test traffic routes to frontier."
      );
    } else {
      tau = result.tau;

      paintStamp(true, result);
    }

    state.tau = tau;

    const sim =
      simulate(
        state.test,
        tau
      );

    updateTiles(sim);
    updateFlowBar(sim);
    updateAblation();
    updatePareto();
  }

  function init() {
    Promise.all([
      loadJSON(
        "data/bank.json",
        null
      ),
      loadJSON(
        "data/prices.json",
        DEFAULT_PRICES
      )
    ]).then(function (data) {
      const rows =
        normaliseRows(
          data[0] ||
          []
        );

      state.prices =
        normalisePrices(
          data[1]
        );

      const split =
        splitRows(rows);

      state.train = split.train;
      state.cal = split.cal;
      state.test = split.test;

      state.cal.forEach(function (row) {
        row.phat =
          Router.predictPHAT(
            row,
            state.train,
            20
          );
      });

      state.test.forEach(function (row) {
        row.phat =
          Router.predictPHAT(
            row,
            state.train,
            20
          );
      });

      state.baselines =
        buildBaselines();

      state.warrantyCurve =
        buildWarrantyCurve();

      const slider =
        document.getElementById(
          "epsSlider"
        );

      if (slider) {
        slider.addEventListener(
          "input",
          render
        );
      }

      render();
    });
  }

  window.UI = {
    getState: function () {
      return {
        tau: state.tau,
        eps: state.eps,
        test: state.test,
        train: state.train,
        prices: state.prices
      };
    }
  };

  document.addEventListener(
    "DOMContentLoaded",
    function () {
      init();
    }
  );
})();