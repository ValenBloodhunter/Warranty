(function () {
  "use strict";

  let state = {
    tau: 1.01,
    eps: 8,
    test: [],
    train: [],
    prices: {}
  };

  let calRows = [];
  let calScores = [];
  let calLosses = [];
  let epsSweep = [];

  const DEFAULT_PRICES = {
    cheap: {
      in_per_1m: 0.15,
      out_per_1m: 0.60
    },
    frontier: {
      in_per_1m: 5.00,
      out_per_1m: 15.00
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function animateNumber(id, value, formatter) {
    const el = $(id);
    if (!el) return;

    const start = Number(el.dataset.value || 0);
    const end = Number(value) || 0;
    const duration = 300;
    const startTime = performance.now();

    function frame(now) {
      const progress = Math.min(
        1,
        (now - startTime) / duration
      );

      const eased =
        1 - Math.pow(1 - progress, 3);

      const current =
        start + (end - start) * eased;

      el.textContent = formatter
        ? formatter(current)
        : current.toFixed(1);

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        el.dataset.value = String(end);
      }
    }

    requestAnimationFrame(frame);
  }

  function percent(value) {
    return Number(value || 0).toFixed(1) + "%";
  }

  function money(value) {
    return "$" + Number(value || 0).toFixed(4);
  }

  async function loadJSON(path, fallback) {
    try {
      const response = await fetch(path);

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      return await response.json();
    } catch (error) {
      if (fallback !== undefined) {
        return fallback;
      }

      throw error;
    }
  }

  function normaliseRows(data) {
    if (Array.isArray(data)) {
      return data;
    }

    if (data && Array.isArray(data.rows)) {
      return data.rows;
    }

    return [];
  }

  function normalisePrices(data) {
    if (!data || typeof data !== "object") {
      return DEFAULT_PRICES;
    }

    if (data.cheap && data.frontier) {
      return data;
    }

    return DEFAULT_PRICES;
  }

  function splitRows(rows) {
    return {
      train: rows.filter(
        row => row && row.split === "train"
      ),

      cal: rows.filter(
        row => row && row.split === "cal"
      ),

      test: rows.filter(
        row => row && row.split === "test"
      )
    };
  }

  function computeCalibration() {
    calScores = [];
    calLosses = [];

    calRows.forEach(function (row) {
      row.phat =
        Router.predictPHat(
          row,
          state.train,
          20
        );

      calScores.push(row.phat);

      calLosses.push(
        Router.lossIfCheap(row)
      );
    });

    state.test.forEach(function (row) {
      row.phat =
        Router.predictPHat(
          row,
          state.train,
          20
        );
    });
  }

  function getCertResult(eps) {
    return certify(
      calScores,
      calLosses,
      eps / 100,
      0.05
    );
  }

  function paintStamp(result) {
    const stamp = $("certStamp");

    if (!stamp) return;

    if (!result) {
      stamp.textContent =
        "REFUSED — ROUTING 100% TO FRONTIER";

      stamp.classList.remove("certified");
      stamp.classList.add("refused");

      return;
    }

    stamp.textContent = "CERTIFIED";

    stamp.classList.remove("refused");
    stamp.classList.add("certified");

    stamp.classList.remove("stamp-press");

    void stamp.offsetWidth;

    stamp.classList.add("stamp-press");

    setTimeout(function () {
      stamp.classList.remove("stamp-press");
    }, 180);
  }

  function updateStampDetail(result) {
    if (!result) {
      setText(
        "stampDetail",
        "No statistically safe threshold found."
      );
      return;
    }

    const tau =
      Number(result.tau ?? result.threshold ?? 0);

    const n =
      Number(result.n ?? calLosses.length);

    const failures =
      Number(result.failures ?? 0);

    const risk =
      Number(
        result.empiricalRisk ??
        result.risk ??
        0
      );

    const pValue =
      Number(
        result.pValue ??
        result.p_value ??
        0
      );

    const delta =
      Number(
        result.delta ??
        0
      );

    setText(
      "stampDetail",
      "τ " + tau.toFixed(3) +
      " · n " + n +
      " · failures " + failures +
      " · risk " + risk.toFixed(4) +
      " · p-value " + pValue.toFixed(4) +
      " · δ " + delta.toFixed(4)
    );
  }

  function simulateAtTau(tau) {
    return Router.simulate(
      state.test,
      tau,
      state.prices,
      {
        verify: true,
        cache: true,
        tau2: 0.5
      }
    );
  }

  function updateTiles(result) {
    const frontier =
      Number(result.costAlwaysFrontier || 0);

    const cost =
      Number(result.cost || 0);

    const saved =
      frontier > 0
        ? ((frontier - cost) / frontier) * 100
        : 0;

    const cheap =
      Number(result.pctCheap || 0) * 100;

    const regression =
      Number(result.regressionRate || 0) * 100;

    const overhead =
      frontier > 0
        ? (Number(result.overheadCost || 0) /
          frontier) * 100
        : 0;

    animateNumber(
      "costSaved",
      saved,
      percent
    );

    animateNumber(
      "pctCheap",
      cheap,
      percent
    );

    animateNumber(
      "testRegression",
      regression,
      percent
    );

    animateNumber(
      "overhead",
      overhead,
      percent
    );
  }

  function updateFlowBar(result) {
    const cheap =
      Number(result.pctCheap || 0);

    const escalated =
      Number(result.pctEscalated || 0);

    const frontier =
      Math.max(
        0,
        1 - cheap
      );

    const cheapDirect =
      Math.max(
        0,
        cheap - escalated
      );

    const frontierFinal =
      Math.max(
        0,
        frontier + escalated
      );

    const cheapBar =
      $("flowCheap");

    const frontierBar =
      $("flowFrontier");

    if (cheapBar) {
      cheapBar.style.width =
        (cheapDirect * 100) + "%";
      cheapBar.style.transition =
        "width 400ms ease";
    }

    if (frontierBar) {
      frontierBar.style.width =
        (frontierFinal * 100) + "%";
      frontierBar.style.transition =
        "width 400ms ease";
    }
  }

  function alwaysFrontier() {
    return Router.simulate(
      state.test,
      1.01,
      state.prices,
      {}
    );
  }

  function alwaysCheap() {
    return Router.simulate(
      state.test,
      -0.01,
      state.prices,
      {}
    );
  }

  function random5050() {
    const rows = state.test;
    const total = rows.length;

    let cost = 0;
    let correct = 0;
    let regression = 0;

    rows.forEach(function (row, index) {
      const useCheap =
        index % 2 === 0;

      const model =
        useCheap ? "cheap" : "frontier";

      cost += Router.costOf(
        row,
        model,
        state.prices
      );

      const ok =
        row[model] &&
        row[model].correct === true;

      if (ok) {
        correct++;
      }

      if (
        !ok &&
        row.frontier &&
        row.frontier.correct === true
      ) {
        regression++;
      }
    });

    return {
      cost: cost,
      costAlwaysFrontier:
        alwaysFrontier().costAlwaysFrontier,
      accuracy:
        total ? correct / total : 0,
      regressionRate:
        total ? regression / total : 0,
      pctCheap: 0.5,
      pctEscalated: 0,
      pctCache: 0,
      overheadCost: 0
    };
  }

  function medianLength(rows) {
    const values = rows
      .map(row =>
        String(row.query || "").length
      )
      .sort(function (a, b) {
        return a - b;
      });

    if (!values.length) return 0;

    const middle =
      Math.floor(values.length / 2);

    if (values.length % 2) {
      return values[middle];
    }

    return (
      values[middle - 1] +
      values[middle]
    ) / 2;
  }

  function lengthHeuristic() {
    const rows = state.test;
    const threshold = medianLength(rows);

    let cost = 0;
    let correct = 0;
    let regression = 0;
    let cheapCount = 0;

    rows.forEach(function (row) {
      const length =
        String(row.query || "").length;

      const useCheap =
        length <= threshold;

      const model =
        useCheap ? "cheap" : "frontier";

      if (useCheap) {
        cheapCount++;
      }

      cost += Router.costOf(
        row,
        model,
        state.prices
      );

      const ok =
        row[model] &&
        row[model].correct === true;

      if (ok) correct++;

      if (
        !ok &&
        row.frontier &&
        row.frontier.correct === true
      ) {
        regression++;
      }
    });

    return {
      cost: cost,
      costAlwaysFrontier:
        alwaysFrontier().costAlwaysFrontier,
      accuracy:
        rows.length
          ? correct / rows.length
          : 0,
      regressionRate:
        rows.length
          ? regression / rows.length
          : 0,
      pctCheap:
        rows.length
          ? cheapCount / rows.length
          : 0,
      pctEscalated: 0,
      pctCache: 0,
      overheadCost: 0
    };
  }

  function fixedThreshold() {
    return Router.simulate(
      state.test,
      0.7,
      state.prices,
      {}
    );
  }

  function buildBaselines() {
    return [
      alwaysFrontier(),
      alwaysCheap(),
      random5050(),
      lengthHeuristic(),
      fixedThreshold()
    ];
  }

  function updateAblation(result) {
    const rows = [
      ["Always frontier", alwaysFrontier()],
      ["Always cheap", alwaysCheap()],
      ["Random 50/50", random5050()],
      ["Length heuristic", lengthHeuristic()],
      ["Fixed threshold 0.7", fixedThreshold()],
      ["Ours", result],
      [
        "Ours + verify",
        Router.simulate(
          state.test,
          state.tau,
          state.prices,
          {
            verify: true,
            tau2: 0.5
          }
        )
      ],
      [
        "Ours + verify + cache",
        result
      ]
    ];

    const table =
      $("ablationTable");

    if (!table) return;

    const tbody =
      table.querySelector("tbody") ||
      table;

    tbody.innerHTML = "";

    rows.forEach(function (item) {
      const name = item[0];
      const r = item[1];

      const tr =
        document.createElement("tr");

      const cost =
        Number(r.cost || 0);

      const accuracy =
        Number(r.accuracy || 0) * 100;

      const regression =
        Number(r.regressionRate || 0) * 100;

      const cheap =
        Number(r.pctCheap || 0) * 100;

      tr.innerHTML =
        "<td>" + name + "</td>" +
        "<td>" + money(cost) + "</td>" +
        "<td>" + percent(accuracy) + "</td>" +
        "<td>" + percent(regression) + "</td>" +
        "<td>" + percent(cheap) + "</td>";

      tbody.appendChild(tr);
    });
  }

  function buildEpsSweep() {
    epsSweep = [];

    for (let eps = 1; eps <= 25; eps += 2) {
      const result =
        getCertResult(eps);

      let tau = 1.01;

      if (result) {
        tau =
          Number(
            result.tau ??
            result.threshold ??
            1.01
          );
      }

      const simulation =
        Router.simulate(
          state.test,
          tau,
          state.prices,
          {
            verify: true,
            cache: true,
            tau2: 0.5
          }
        );

      epsSweep.push({
        eps: eps,
        tau: tau,
        cost: simulation.cost,
        accuracy: simulation.accuracy,
        regressionRate:
          simulation.regressionRate
      });
    }
  }

  function updatePareto() {
    if (!window.Charts) return;

    const baselines =
      buildBaselines();

    const baselinePoints =
      baselines.map(function (r) {
        return {
          x: Number(r.cost || 0),
          y: Number(r.accuracy || 0)
        };
      });

    const curve =
      epsSweep.map(function (r) {
        return {
          x: Number(r.cost || 0),
          y: Number(r.accuracy || 0)
        };
      });

    const current =
      simulateAtTau(state.tau);

    const currentPoint = {
      x: Number(current.cost || 0),
      y: Number(current.accuracy || 0)
    };

    Charts.updatePareto(
      currentPoint,
      baselinePoints.concat(curve)
    );
  }

  function render() {
    const epsSlider =
      $("epsSlider");

    const eps =
      epsSlider
        ? Number(epsSlider.value)
        : state.eps;

    state.eps = eps;


const epsValue = document.getElementById("epsValue");

if (epsValue) {
  epsValue.textContent = eps + "%";
}

const certification =
  getCertResult(eps);

    paintStamp(certification);
    updateStampDetail(certification);

    if (!certification) {
      state.tau = 1.01;

      const refused =
        Router.simulate(
          state.test,
          1.01,
          state.prices,
          {}
        );

      updateTiles(refused);
      updateFlowBar(refused);
      updateAblation(refused);
      updatePareto();

      return;
    }

    state.tau =
      Number(
        certification.tau ??
        certification.threshold ??
        1.01
      );

    const result =
      simulateAtTau(state.tau);

    updateTiles(result);
    updateFlowBar(result);
    updateAblation(result);
    updatePareto();

    const gauge =
      $("regressionGauge");

    if (
      gauge &&
      window.Charts &&
      Charts.drawGauge
    ) {
      Charts.drawGauge(
        gauge,
        Number(result.regressionRate || 0),
        Number(eps / 100)
      );
    }
  }

  async function init() {
    const data =
      await loadJSON(
        "data/bank.json",
        null
      );

    let rows = data;

    if (!rows) {
      rows =
        await loadJSON(
          "data/bank.sample.json",
          []
        );
    }

    const pricesData =
      await loadJSON(
        "data/prices.json",
        DEFAULT_PRICES
      );

    const split =
      splitRows(
        normaliseRows(rows)
      );

    state.train = split.train;
    calRows = split.cal;
    state.test = split.test;
    state.prices =
      normalisePrices(pricesData);

    computeCalibration();
    buildEpsSweep();

    if (window.Charts) {
      Charts.initPareto();
    }

    const slider =
      $("epsSlider");

    if (slider) {
      state.eps =
        Number(slider.value || 8);

      slider.addEventListener(
        "input",
        function () {
          render();
        }
      );
    }

    render();
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
      init().catch(function (error) {
        console.error(
          "WARRANTY UI failed to initialise:",
          error
        );

        setText(
          "stampDetail",
          "Failed to load routing data."
        );
      });
    }
  );
})();