(function () {
  "use strict";

  const $ = id =>
    document.getElementById(id);

  let running = false;
  let abortRequested = false;
  let startedAt = 0;

  let originalEpsilon = 8;
  let originalMode = "normal";


  // ============================================================
  // TIME HELPERS
  // ============================================================

  function sleep(ms) {
    return new Promise(
      resolve =>
        setTimeout(resolve, ms)
    );
  }


  async function wait(ms) {
    const pieces =
      Math.ceil(ms / 200);

    for (
      let i = 0;
      i < pieces;
      i++
    ) {
      if (abortRequested) {
        throw new Error(
          "JUDGE_ABORT"
        );
      }

      await sleep(
        Math.min(
          200,
          ms - i * 200
        )
      );
    }
  }


  // ============================================================
  // CAPTION
  // ============================================================

  function caption(text) {
    const element =
      $("judge-caption");

    if (!element) {
      return;
    }

    element.textContent =
      text;

    element.classList.remove(
      "hidden"
    );
  }


  function hideCaption() {
    const element =
      $("judge-caption");

    if (element) {
      element.classList.add(
        "hidden"
      );
    }
  }


  // ============================================================
  // MODE
  // ============================================================

  async function setMode(mode) {
    const select =
      $("criticalityMode");

    if (!select) {
      return;
    }

    select.value =
      mode;

    select.dispatchEvent(
      new Event(
        "change",
        {
          bubbles: true
        }
      )
    );

    await wait(500);
  }


  // ============================================================
  // EPSILON
  // ============================================================

  async function setEpsilon(value) {
    const slider =
      $("epsSlider");

    if (!slider) {
      return;
    }

    slider.value =
      String(value);

    slider.dispatchEvent(
      new Event(
        "input",
        {
          bubbles: true
        }
      )
    );


    /*
      Your UI exposes renderNow(),
      so force a clean render too.
    */

    if (
      window.UI &&
      typeof UI.renderNow ===
        "function"
    ) {
      await UI.renderNow();
    }


    await wait(500);
  }


  // ============================================================
  // REPLAY STATE WAIT
  // ============================================================

  async function waitForReplay(
    condition,
    timeout = 15000
  ) {
    const start =
      Date.now();

    while (
      Date.now() - start <
      timeout
    ) {
      if (abortRequested) {
        throw new Error(
          "JUDGE_ABORT"
        );
      }


      if (
        window.Replay &&
        typeof Replay.getState ===
          "function"
      ) {
        const state =
          Replay.getState();

        if (condition(state)) {
          return true;
        }
      }


      await sleep(250);
    }


    return false;
  }


  // ============================================================
  // SAVE USER SETTINGS
  // ============================================================

  function saveOriginalState() {
    const slider =
      $("epsSlider");

    const mode =
      $("criticalityMode");


    originalEpsilon =
      Number(
        slider?.value
      ) || 8;


    originalMode =
      mode?.value ||
      "normal";
  }


  // ============================================================
  // BUTTON
  // ============================================================

  function updateButton() {
    const button =
      $("judge-mode-btn");

    if (!button) {
      return;
    }


    button.textContent =
      running
        ? "■ Stop Judge Mode"
        : "▶ Judge Mode";
  }


  // ============================================================
  // ABORT
  // ============================================================

  function requestAbort() {
    if (!running) {
      return;
    }


    /*
      Prevent the same click that starts
      Judge Mode from instantly aborting it.
    */

    if (
      Date.now() -
      startedAt <
      2000
    ) {
      return;
    }


    abortRequested = true;
  }


  // ============================================================
  // HIGHLIGHT
  // ============================================================

  function highlight(
    element,
    duration = 4000
  ) {
    if (!element) {
      return;
    }


    element.style.transition =
      "box-shadow 250ms ease";

    element.style.boxShadow =
      "0 0 0 2px rgba(255,255,255,0.18), 0 0 35px rgba(59,130,246,0.18)";


    setTimeout(
      () => {
        element.style.boxShadow =
          "";
      },
      duration
    );
  }


  // ============================================================
  // MAIN DEMO
  // ============================================================

  async function runJudgeMode() {
    if (running) {
      requestAbort();
      return;
    }


    running = true;
    abortRequested = false;
    startedAt = Date.now();

    saveOriginalState();

    updateButton();


    try {

      // ========================================================
      // STAGE 1 — NORMAL CERTIFIED POLICY
      // ========================================================

      caption(
        "1/8 • Start with a practical 8% quality-regression budget."
      );

      await setMode(
        "normal"
      );

      await setEpsilon(
        8
      );

      await wait(
        7000
      );


      // ========================================================
      // STAGE 2 — STRICT POLICY / REFUSAL
      // ========================================================

      caption(
        "2/8 • Tighten the guarantee. WARRANTY becomes conservative rather than guessing."
      );

      await setEpsilon(
        1
      );

      await wait(
        7000
      );


      // ========================================================
      // STAGE 3 — EPSILON SWEEP
      // ========================================================

      caption(
        "3/8 • Sweep ε to expose the cost-vs-accuracy trade-off."
      );


      const sweep = [
        3,
        5,
        8,
        11,
        14,
        17,
        20,
        25
      ];


      for (
        const eps of sweep
      ) {
        await setEpsilon(
          eps
        );

        await wait(
          1300
        );
      }


      // ========================================================
      // STAGE 4 — PARETO
      // ========================================================

      caption(
        "4/8 • The Pareto frontier shows the best cost/accuracy operating points."
      );


      const pareto =
        $("paretoChart");

      highlight(
        pareto?.parentElement
      );


      await wait(
        7000
      );


      // ========================================================
      // RETURN TO 8%
      // ========================================================

      await setEpsilon(
        8
      );


      // ========================================================
      // STAGE 5 — REPLAY
      // ========================================================

      caption(
        "5/8 • Replay held-out TEST queries as simulated live production traffic."
      );


      if (
        window.Replay &&
        typeof Replay.reset ===
          "function"
      ) {
        Replay.reset();
      }


      if (
        window.Replay &&
        typeof Replay.start ===
          "function"
      ) {
        Replay.start();
      }


      await wait(
        10000
      );


      // ========================================================
      // STAGE 6 — INJECT DRIFT
      // ========================================================

      caption(
        "6/8 • Inject drift: traffic shifts toward queries the cheap model is over-confident on."
      );


      if (
        window.Replay &&
        typeof Replay.injectDrift ===
          "function"
      ) {
        Replay.injectDrift();
      }


      const suspended =
        await waitForReplay(
          state =>
            state.suspended === true,
          15000
        );


      if (suspended) {
        caption(
          "⚠ Drift detected • runtime regression exceeded ε • routing SUSPENDED."
        );

        await wait(
          6000
        );

      } else {
        caption(
          "Drift traffic injected • monitoring the live safety window."
        );

        await wait(
          4000
        );
      }


      // ========================================================
      // STAGE 7 — RECOVERY
      // ========================================================

      caption(
        "7/8 • WARRANTY raises τ, sends more traffic to frontier, and waits for risk to fall."
      );


      const recovered =
        await waitForReplay(
          state =>
            (
              !state.suspended &&
              !state.driftMode
            ),
          20000
        );


      if (recovered) {
        caption(
          "✓ Recovery complete • regression is back inside the allowed budget."
        );

      } else {
        caption(
          "Safety policy remains conservative while monitoring continues."
        );
      }


      await wait(
        6000
      );


      // ========================================================
      // STAGE 8 — ABLATION
      // ========================================================

      caption(
        "8/8 • Ablation shows what routing, verification and cache each contribute."
      );


      if (
        window.Replay &&
        typeof Replay.stop ===
          "function"
      ) {
        Replay.stop();
      }


      const ablation =
        $("ablationBody");

      highlight(
        ablation?.parentElement,
        7000
      );


      await wait(
        8000
      );


      caption(
        "Demo complete • WARRANTY saves cost while enforcing a measurable quality-regression budget."
      );


      await wait(
        5000
      );


    } catch (error) {

      if (
        error?.message ===
        "JUDGE_ABORT"
      ) {
        caption(
          "Judge Mode stopped."
        );

      } else {
        console.error(
          "Judge Mode error:",
          error
        );

        caption(
          "Judge Mode stopped because of an unexpected error."
        );
      }


    } finally {

      if (
        window.Replay &&
        typeof Replay.stop ===
          "function"
      ) {
        Replay.stop();
      }


      running = false;
      abortRequested = false;

      updateButton();


      setTimeout(
        () => {
          if (!running) {
            hideCaption();
          }
        },
        3000
      );
    }
  }


  // ============================================================
  // DOM
  // ============================================================

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      const button =
        $("judge-mode-btn");


      if (button) {
        button.addEventListener(
          "click",
          runJudgeMode
        );
      }


      /*
        ESC cleanly aborts the demo.
      */

      document.addEventListener(
        "keydown",
        event => {
          if (
            running &&
            event.key === "Escape"
          ) {
            requestAbort();
          }
        }
      );
    }
  );


  // ============================================================
  // PUBLIC API
  // ============================================================

  window.JudgeMode = {

    start:
      runJudgeMode,

    stop:
      requestAbort,

    isRunning() {
      return running;
    }
  };

})();