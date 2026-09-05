(function () {
  "use strict";

  let paretoChart = null;

  function getCanvas() {
    return document.getElementById("paretoChart");
  }

  function initPareto() {
    const canvas = getCanvas();

    if (!canvas) {
      console.warn("Pareto chart canvas not found.");
      return null;
    }

    if (typeof Chart === "undefined") {
      console.warn("Chart.js is not loaded.");
      return null;
    }

    const ctx = canvas.getContext("2d");

    paretoChart = new Chart(ctx, {
      type: "scatter",

      data: {
        datasets: [
          {
            label: "WARRANTY",
            data: [],
            showLine: true,
            fill: false,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 7
          },
          {
            label: "Baselines",
            data: [],
            showLine: false,
            pointRadius: 6,
            pointHoverRadius: 9
          },
          {
            label: "Current ε",
            data: [],
            showLine: false,
            pointRadius: 9,
            pointHoverRadius: 12
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            display: true
          },

          tooltip: {
            callbacks: {
              label: function (context) {
                const point = context.raw || {};

                const accuracy =
                  Number(point.y || 0) * 100;

                const cost =
                  Number(point.x || 0);

                return (
                  context.dataset.label +
                  ": " +
                  accuracy.toFixed(1) +
                  "% accuracy, $" +
                  cost.toFixed(4)
                );
              }
            }
          }
        },

        scales: {
          x: {
            title: {
              display: true,
              text: "Cost"
            },
            beginAtZero: true
          },

          y: {
            title: {
              display: true,
              text: "Accuracy"
            },
            min: 0,
            max: 1
          }
        }
      }
    });

    return paretoChart;
  }

  function updatePareto(
    warrantyCurve,
    baselinePoints,
    currentPoint
  ) {
    if (!paretoChart) {
      initPareto();
    }

    if (!paretoChart) return;

    warrantyCurve =
      Array.isArray(warrantyCurve)
        ? warrantyCurve
        : [];

    baselinePoints =
      Array.isArray(baselinePoints)
        ? baselinePoints
        : [];

    currentPoint =
      currentPoint || null;

    paretoChart.data.datasets[0].data =
      warrantyCurve;

    paretoChart.data.datasets[1].data =
      baselinePoints;

    paretoChart.data.datasets[2].data =
      currentPoint
        ? [currentPoint]
        : [];

    paretoChart.update();
  }

  function drawGauge(canvasOrId, value, maxValue) {
    let canvas = canvasOrId;

    if (typeof canvasOrId === "string") {
      canvas =
        document.getElementById(canvasOrId);
    }

    if (!canvas) {
      console.warn("Gauge canvas not found.");
      return;
    }

    const ctx = canvas.getContext("2d");

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(
      0,
      0,
      width,
      height
    );

    const centerX = width / 2;
    const centerY = height * 0.82;

    const radius =
      Math.min(width, height) * 0.34;

    const max =
      Number(maxValue) > 0
        ? Number(maxValue)
        : 1;

    let current =
      Number(value);

    if (!Number.isFinite(current)) {
      current = 0;
    }

    current =
      Math.max(
        0,
        Math.min(current, max)
      );

    const ratio =
      current / max;

    const startAngle = Math.PI;

    ctx.beginPath();

    ctx.arc(
      centerX,
      centerY,
      radius,
      startAngle,
      Math.PI * 2
    );

    ctx.lineWidth = 18;
    ctx.strokeStyle = "#e5e7eb";
    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
      centerX,
      centerY,
      radius,
      startAngle,
      startAngle + Math.PI * ratio
    );

    ctx.lineWidth = 18;
    ctx.strokeStyle = "#111827";
    ctx.stroke();

    const needleAngle =
      startAngle +
      Math.PI * ratio;

    const needleLength =
      radius * 0.82;

    const needleX =
      centerX +
      Math.cos(needleAngle) *
      needleLength;

    const needleY =
      centerY +
      Math.sin(needleAngle) *
      needleLength;

    ctx.beginPath();

    ctx.moveTo(
      centerX,
      centerY
    );

    ctx.lineTo(
      needleX,
      needleY
    );

    ctx.lineWidth = 4;
    ctx.strokeStyle = "#111827";
    ctx.stroke();

    ctx.beginPath();

    ctx.arc(
      centerX,
      centerY,
      7,
      0,
      Math.PI * 2
    );

    ctx.fillStyle = "#111827";
    ctx.fill();

    ctx.font =
      "600 22px Arial";

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111827";

    ctx.fillText(
      (current * 100).toFixed(1) + "%",
      centerX,
      centerY - radius * 0.35
    );
  }

  window.Charts = {
    initPareto: initPareto,
    updatePareto: updatePareto,
    drawGauge: drawGauge
  };
})();