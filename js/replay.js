(function () {
  "use strict";

  const $ = id =>
    document.getElementById(id);

  const STEP_MS = 250;
  const WINDOW_SIZE = 20;
  const MAX_SQUARES = 70;
  const VERIFY_TAU = 0.5;

  let timer = null;

  let running = false;
  let driftMode = false;
  let suspended = false;

  let normalIndex = 0;
  let driftIndex = 0;

  let baseTau = 1.01;
  let liveTau = 1.01;
  let epsilon = 0.08;

  let recent = [];
  let history = [];

  const seenQueries =
    new Set();

  let savedStamp = null;


  // ============================================================
  // GET CURRENT WARRANTY STATE
  // ============================================================

  function getUIState() {

    if (
      window.UI &&
      typeof window.UI.getState === "function"
    ) {
      return window.UI.getState();
    }

    return null;
  }


  // ============================================================
  // DATA HELPERS
  // ============================================================

  function pHat(row) {

    const value =
      Number(row?.phat);

    return Number.isFinite(value)
      ? value
      : 0;
  }


  function cheapCorrect(row) {

    return Boolean(
      row?.cheap?.correct === true
    );
  }


  function frontierCorrect(row) {

    return Boolean(
      row?.frontier?.correct === true
    );
  }


  function verificationScore(row) {

    const consistency =
      Number(
        row?.self_consistency
      ) || 0;

    const rating =
      Number(
        row?.self_rating
      ) || 0;

    return (
      consistency *
      rating /
      100
    );
  }


  // ============================================================
  // FIND DRIFT QUERIES
  //
  // These are queries the router trusts enough to try cheap,
  // verification also accepts them,
  // but cheap is actually wrong while frontier is correct.
  // ============================================================

  function driftPool(rows) {

    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .filter(row => {

        return (
          pHat(row) >= baseTau &&
          verificationScore(row) >= VERIFY_TAU &&
          !cheapCorrect(row) &&
          frontierCorrect(row)
        );

      })
      .sort(
        (a, b) =>
          pHat(b) - pHat(a)
      );
  }


  // ============================================================
  // ROUTE ONE QUERY
  // ============================================================

  function routeOne(row) {

    const query =
      String(
        row?.query || ""
      );

    const phat =
      pHat(row);

    let route =
      "frontier";

    let finalCorrect =
      false;

    let cacheHit =
      false;

    let escalated =
      false;

    let verifyScore =
      null;


    // During drift we intentionally represent new shifted traffic,
    // so repeated demo rows should not become exact cache hits.
    if (
      !driftMode &&
      seenQueries.has(query)
    ) {

      cacheHit = true;
      route = "cache";

      /*
        Match our current prototype cache behaviour.
      */
      finalCorrect =
        cheapCorrect(row) ||
        frontierCorrect(row);

    } else {

      seenQueries.add(query);


      // ----------------------------------------------------------
      // TRY CHEAP
      // ----------------------------------------------------------

      if (phat >= liveTau) {

        verifyScore =
          verificationScore(row);


        // --------------------------------------------------------
        // VERIFICATION FAILED -> ESCALATE
        // --------------------------------------------------------

        if (
          verifyScore <
          VERIFY_TAU
        ) {

          escalated = true;
          route = "escalated";

          finalCorrect =
            frontierCorrect(row);

        } else {

          route = "cheap";

          finalCorrect =
            cheapCorrect(row);
        }


      // ----------------------------------------------------------
      // DIRECT FRONTIER
      // ----------------------------------------------------------

      } else {

        route = "frontier";

        finalCorrect =
          frontierCorrect(row);
      }
    }


    /*
      Regression means WARRANTY produced a wrong result
      in a case where frontier would have been correct.
    */
    const regression =
      !finalCorrect &&
      frontierCorrect(row);


    return {

      row,

      id:
        row?.id || "",

      query,

      phat,

      tau:
        liveTau,

      route,

      cacheHit,

      escalated,

      verificationScore:
        verifyScore,

      finalCorrect,

      regression
    };
  }


  // ============================================================
  // TICKER SQUARE
  // ============================================================

  function addSquare(result) {

    const ticker =
      $("replay-ticker");

    if (!ticker) {
      return;
    }


    const square =
      document.createElement(
        "button"
      );

    square.type =
      "button";

    square.className =
      "w-3 h-3 rounded-[3px] flex-shrink-0 " +
      "transition-transform duration-150 hover:scale-125";


    /*
      C11 colours:

      GREEN = cheap succeeded
      RED   = routing regression
      BLUE  = frontier/escalated
      GREY  = cache
    */

    if (result.cacheHit) {

      square.classList.add(
        "bg-slate-500"
      );

    } else if (
      result.regression
    ) {

      square.classList.add(
        "bg-red-500"
      );

    } else if (
      result.route === "cheap" &&
      result.finalCorrect
    ) {

      square.classList.add(
        "bg-emerald-400"
      );

    } else if (
      result.route === "frontier" ||
      result.route === "escalated"
    ) {

      square.classList.add(
        "bg-blue-500"
      );

    } else {

      // Both models may be wrong.
      // This is NOT routing-induced regression.
      square.classList.add(
        "bg-amber-400"
      );
    }


    square.title =
      result.route.toUpperCase() +
      " | p-hat=" +
      result.phat.toFixed(2) +
      " | tau=" +
      result.tau.toFixed(2) +
      (
        result.regression
          ? " | REGRESSION"
          : ""
      );


    /*
      Save the result so C12 Decision Trace
      can use this exact square later.
    */
    square._warrantyTrace =
      result;


    square.addEventListener(
      "click",
      () => {

        window.dispatchEvent(
          new CustomEvent(
            "warranty:trace",
            {
              detail:
                result
            }
          )
        );
      }
    );


    ticker.appendChild(
      square
    );


    while (
      ticker.children.length >
      MAX_SQUARES
    ) {

      ticker.removeChild(
        ticker.firstElementChild
      );
    }


    ticker.scrollLeft =
      ticker.scrollWidth;
  }


  // ============================================================
  // LIVE REGRESSION
  // ============================================================

  function regressionRate() {

    if (!recent.length) {
      return 0;
    }

    const failures =
      recent.reduce(
        (sum, value) =>
          sum + value,
        0
      );

    return (
      failures /
      recent.length
    );
  }


  function drawGauge(rate) {

    if (
      window.Charts &&
      typeof Charts.drawGauge ===
        "function"
    ) {

      const maxValue =
        Math.max(
          0.10,
          epsilon * 1.5
        );

      Charts.drawGauge(
        "regression-gauge",
        rate,
        maxValue
      );
    }


    const canvas =
      $("regression-gauge");

    if (canvas) {

      canvas.title =
        "Live regression: " +
        (
          rate * 100
        ).toFixed(1) +
        "%";
    }
  }


  // ============================================================
  // STAMP
  // ============================================================

  function saveCurrentStamp() {

    const stamp =
      $("certStamp");

    const detail =
      $("stampDetail");


    savedStamp = {

      stampText:
        stamp?.textContent || "",

      stampStyle:
        stamp?.getAttribute(
          "style"
        ),

      detailText:
        detail?.textContent || ""
    };
  }


  function restoreStamp() {

    if (!savedStamp) {
      return;
    }

    const stamp =
      $("certStamp");

    const detail =
      $("stampDetail");


    if (stamp) {

      stamp.textContent =
        savedStamp.stampText;

      if (
        savedStamp.stampStyle ===
        null
      ) {

        stamp.removeAttribute(
          "style"
        );

      } else {

        stamp.setAttribute(
          "style",
          savedStamp.stampStyle
        );
      }
    }


    if (detail) {

      detail.textContent =
        savedStamp.detailText;
    }
  }


  function showSuspended(rate) {

    const stamp =
      $("certStamp");

    const detail =
      $("stampDetail");


    if (stamp) {

      stamp.textContent =
        "⚠ SUSPENDED — DRIFT DETECTED";

      stamp.style.backgroundColor =
        "rgba(127, 29, 29, 0.45)";

      stamp.style.borderColor =
        "#ef4444";

      stamp.style.color =
        "#fecaca";
    }


    if (detail) {

      detail.textContent =
        "live τ = " +
        liveTau.toFixed(2) +
        " • live regression = " +
        (
          rate * 100
        ).toFixed(1) +
        "% • ε = " +
        (
          epsilon * 100
        ).toFixed(1) +
        "%";
    }
  }


  function showRecovered(rate) {

    const stamp =
      $("certStamp");

    const detail =
      $("stampDetail");


    if (stamp) {

      stamp.textContent =
        "✓ CERTIFIED — RECOVERED";

      stamp.style.backgroundColor =
        "rgba(6, 78, 59, 0.40)";

      stamp.style.borderColor =
        "#10b981";

      stamp.style.color =
        "#a7f3d0";
    }


    if (detail) {

      detail.textContent =
        "recovered • live τ = " +
        liveTau.toFixed(2) +
        " • live regression = " +
        (
          rate * 100
        ).toFixed(1) +
        "%";
    }
  }


  function showDriftActive() {

    const detail =
      $("stampDetail");

    if (detail) {

      detail.textContent =
        "DRIFT ACTIVE • monitoring live regression • τ = " +
        liveTau.toFixed(2);
    }
  }


  // ============================================================
  // PROCESS ONE LIVE QUERY
  // ============================================================

  function tick() {

    const state =
      getUIState();


    if (
      !state ||
      !Array.isArray(state.test) ||
      !state.test.length
    ) {

      return;
    }


    /*
      Once SUSPENDED, become more conservative.
      Raising tau means fewer queries qualify for cheap.
    */
    if (suspended) {

      liveTau =
        Math.min(
          1.01,
          liveTau + 0.03
        );
    }


    let row;


    // ------------------------------------------------------------
    // DRIFT TRAFFIC
    // ------------------------------------------------------------

    if (driftMode) {

      const badRows =
        driftPool(
          state.test
        );


      if (badRows.length) {

        row =
          badRows[
            driftIndex %
            badRows.length
          ];

        driftIndex++;

      } else {

        console.warn(
          "No suitable drift rows found."
        );

        driftMode =
          false;
      }
    }


    // ------------------------------------------------------------
    // NORMAL TRAFFIC
    // ------------------------------------------------------------

    if (!row) {

      row =
        state.test[
          normalIndex %
          state.test.length
        ];

      normalIndex++;
    }


    const result =
      routeOne(row);


    history.push(
      result
    );


    recent.push(
      result.regression
        ? 1
        : 0
    );


    if (
      recent.length >
      WINDOW_SIZE
    ) {

      recent.shift();
    }


    const rate =
      regressionRate();


    addSquare(
      result
    );

    drawGauge(
      rate
    );


    // ==========================================================
    // DRIFT DETECTION
    // ==========================================================

    if (
      driftMode &&
      !suspended &&
      recent.length >= 12 &&
      rate > epsilon
    ) {

      suspended =
        true;

      showSuspended(
        rate
      );

      return;
    }


    // ==========================================================
    // SUSPENDED STATE
    // ==========================================================

    if (suspended) {

      showSuspended(
        rate
      );


      /*
        Once the rolling regression comes back
        underneath epsilon, recover.
      */
      if (
        recent.length >= 12 &&
        rate <= epsilon
      ) {

        suspended =
          false;

        driftMode =
          false;

        showRecovered(
          rate
        );


        const driftBtn =
          $("drift-btn");

        if (driftBtn) {

          driftBtn.textContent =
            "⚡ Inject Drift";
        }
      }
    }
  }


  // ============================================================
  // START REPLAY
  // ============================================================

  function startReplay() {

    if (running) {
      return;
    }


    const state =
      getUIState();


    if (
      !state ||
      !Array.isArray(state.test) ||
      !state.test.length
    ) {

      console.warn(
        "WARRANTY test data is not ready."
      );

      return;
    }


    saveCurrentStamp();


    baseTau =
      Number.isFinite(
        Number(state.tau)
      )
        ? Number(state.tau)
        : 1.01;


    liveTau =
      baseTau;


    epsilon =
      Math.max(
        0,
        Number(state.eps) || 0
      ) / 100;


    recent = [];
    history = [];

    normalIndex = 0;
    driftIndex = 0;

    driftMode = false;
    suspended = false;

    seenQueries.clear();


    const ticker =
      $("replay-ticker");

    if (ticker) {

      ticker.innerHTML =
        "";
    }


    running =
      true;


    const replayBtn =
      $("replay-btn");

    if (replayBtn) {

      replayBtn.textContent =
        "■ Stop";
    }


    drawGauge(0);


    tick();


    timer =
      setInterval(
        tick,
        STEP_MS
      );
  }


  // ============================================================
  // STOP
  // ============================================================

  function stopReplay(
    restore = true
  ) {

    if (timer) {

      clearInterval(
        timer
      );

      timer = null;
    }


    running =
      false;

    driftMode =
      false;

    suspended =
      false;


    const replayBtn =
      $("replay-btn");

    const driftBtn =
      $("drift-btn");


    if (replayBtn) {

      replayBtn.textContent =
        "▶ Replay";
    }


    if (driftBtn) {

      driftBtn.textContent =
        "⚡ Inject Drift";
    }


    if (restore) {

      restoreStamp();
    }
  }


  // ============================================================
  // INJECT DRIFT
  // ============================================================

  function injectDrift() {

    if (!running) {

      startReplay();
    }


    const state =
      getUIState();


    if (!state) {
      return;
    }


    /*
      Critical mode / epsilon zero is already
      100% conservative, so there is nothing
      meaningful to break with this demo.
    */
    if (
      Number(state.eps) <= 0
    ) {

      const button =
        $("drift-btn");

      if (button) {

        button.textContent =
          "Switch to NORMAL first";

        setTimeout(
          () => {

            button.textContent =
              "⚡ Inject Drift";

          },
          1800
        );
      }

      return;
    }


    const pool =
      driftPool(
        state.test
      );


    if (!pool.length) {

      console.warn(
        "No trusted regression examples available for drift."
      );

      const button =
        $("drift-btn");

      if (button) {

        button.textContent =
          "No drift cases found";

        setTimeout(
          () => {

            button.textContent =
              "⚡ Inject Drift";

          },
          1800
        );
      }

      return;
    }


    driftMode =
      true;

    suspended =
      false;

    driftIndex =
      0;


    const button =
      $("drift-btn");

    if (button) {

      button.textContent =
        "⚡ Drift Active";
    }


    showDriftActive();
  }


  // ============================================================
  // RESET
  // ============================================================

  function resetReplay() {

    stopReplay();

    recent = [];
    history = [];

    seenQueries.clear();

    normalIndex = 0;
    driftIndex = 0;


    const ticker =
      $("replay-ticker");

    if (ticker) {

      ticker.innerHTML =
        "";
    }


    drawGauge(0);
  }


  // ============================================================
  // BUTTONS
  // ============================================================

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      const replayBtn =
        $("replay-btn");

      const driftBtn =
        $("drift-btn");


      if (replayBtn) {

        replayBtn.addEventListener(
          "click",
          () => {

            if (running) {

              stopReplay();

            } else {

              startReplay();
            }
          }
        );
      }


      if (driftBtn) {

        driftBtn.addEventListener(
          "click",
          injectDrift
        );
      }


      drawGauge(0);
    }
  );


  // ============================================================
  // PUBLIC API
  // Used later by Trace + Judge Mode
  // ============================================================

  window.Replay = {

    start:
      startReplay,

    stop:
      stopReplay,

    reset:
      resetReplay,

    injectDrift:
      injectDrift,

    getHistory() {

      return history.slice();
    },

    getState() {

      return {

        running,

        driftMode,

        suspended,

        epsilon,

        baseTau,

        liveTau,

        regressionRate:
          regressionRate()
      };
    }
  };

})();