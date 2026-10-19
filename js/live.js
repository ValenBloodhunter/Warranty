(function () {
  "use strict";

  const ACCESS_CODE_KEY = "warranty-demo-access-code";
  const $ = id => document.getElementById(id);
  const conversation = [];

  function tokens(text) {
    const found = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const counts = new Map();
    for (const token of found) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
    return counts;
  }

  function estimateCheapFit(prompt, rows) {
    const documents = Array.isArray(rows) ? rows : [];
    const queryTerms = tokens(prompt);

    if (!documents.length || !queryTerms.size) return 0;

    const documentFrequencies = new Map();
    for (const row of documents) {
      const unique = new Set(tokens(String(row?.query || "")).keys());
      for (const token of unique) {
        documentFrequencies.set(token, (documentFrequencies.get(token) || 0) + 1);
      }
    }

    const idf = token =>
      Math.log(1 + (documents.length + 1) / ((documentFrequencies.get(token) || 0) + 1));

    const queryVector = new Map();
    for (const [token, count] of queryTerms) queryVector.set(token, count * idf(token));

    const queryNorm = Math.sqrt([...queryVector.values()].reduce((sum, value) => sum + value * value, 0));
    if (!queryNorm) return 0;

    const neighbours = documents.map(row => {
      const documentTerms = tokens(String(row?.query || ""));
      let dot = 0;
      let documentNormSquared = 0;

      for (const [token, count] of documentTerms) {
        const weight = count * idf(token);
        documentNormSquared += weight * weight;
        dot += weight * (queryVector.get(token) || 0);
      }

      const documentNorm = Math.sqrt(documentNormSquared);
      return {
        row,
        similarity: documentNorm ? dot / (queryNorm * documentNorm) : 0
      };
    }).filter(item => item.similarity > 0 && item.row?.cheap)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);

    const totalWeight = neighbours.reduce((sum, item) => sum + item.similarity, 0);
    if (!totalWeight) return 0;

    return neighbours.reduce((sum, item) => {
      return sum + item.similarity * (item.row.cheap.correct === true ? 1 : 0);
    }, 0) / totalWeight;
  }

  function setStatus(text, style) {
    const status = $("try-status");
    if (!status) return;
    status.textContent = text;
    status.className = "text-[10px] px-2 py-1 rounded-lg " + (style || "bg-slate-800 text-slate-400");
  }

  function getTrainingRows() {
    try {
      return window.UI?.getState?.()?.train || [];
    } catch (_) {
      return [];
    }
  }

  function addMessage(role, content) {
    const thread = $("try-thread");
    const message = document.createElement("article");
    message.className = role === "user"
      ? "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-[#c5ff65] px-4 py-3 text-sm text-[#0a0d0b]"
      : "mr-auto max-w-[92%] rounded-2xl rounded-bl-md border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200";
    message.setAttribute("data-role", role);
    message.textContent = content;
    thread.appendChild(message);
    thread.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return message;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = $("try-form");
    const accessCode = $("try-access-code");
    const promptInput = $("try-prompt");
    const submit = $("try-submit");
    const answer = $("try-answer");
    const modeSelect = $("try-mode");
    const clearButton = $("try-clear");

    if (!form || !accessCode || !promptInput || !submit || !answer || !modeSelect) return;

    try {
      accessCode.value = sessionStorage.getItem(ACCESS_CODE_KEY) || "";
    } catch (_) {
      // The user can still enter an access code if storage is disabled.
    }

    clearButton?.addEventListener("click", () => {
      conversation.length = 0;
      $("try-thread").replaceChildren();
      answer.textContent = "";
      $("try-answer-panel").classList.add("hidden");
      $("try-result").classList.add("hidden");
      $("try-usage").textContent = "";
      setStatus("READY");
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const prompt = promptInput.value.trim();
      const code = accessCode.value.trim();
      if (!prompt) {
        promptInput.focus();
        return;
      }
      if (!code) {
        setStatus("ACCESS CODE REQUIRED", "bg-amber-950 text-amber-300");
        accessCode.focus();
        answer.textContent = "Enter the demo access code supplied by the site owner.";
        $("try-answer-panel")?.classList.remove("hidden");
        return;
      }

      try {
        sessionStorage.setItem(ACCESS_CODE_KEY, code);
      } catch (_) {
        // Storage is only a convenience; the code is sent for this request either way.
      }

      const rows = getTrainingRows();
      if (!rows.length) {
        setStatus("DATA NOT READY", "bg-amber-950 text-amber-300");
        answer.textContent = "The benchmark has not loaded yet. Reload after the page finishes loading.";
        $("try-answer-panel")?.classList.remove("hidden");
        return;
      }

      const estimate = estimateCheapFit(prompt, rows);
      const state = window.UI.getState();
      const threshold = Number(state.tau);
      const selectedMode = modeSelect.value;
      const route = selectedMode === "auto"
        ? (Number.isFinite(threshold) && estimate >= threshold ? "cheap" : "frontier")
        : selectedMode;
      const modelName = route === "cheap" ? "Cheap model" : "Frontier model";

      $("try-phat").textContent = estimate.toFixed(2);
      $("try-tau").textContent = Number.isFinite(threshold) ? threshold.toFixed(2) : "—";
      $("try-route").textContent = modelName;
      $("try-similarity").textContent = "TF-IDF text match";
      $("try-result").classList.remove("hidden");
      $("try-answer-panel").classList.remove("hidden");
      $("try-model").textContent = "Requesting " + modelName.toLowerCase() + "…";
      $("try-usage").textContent = "";
      answer.textContent = "";
      $("try-answer-panel").classList.remove("hidden");
      const userMessage = addMessage("user", prompt);
      const pendingMessage = addMessage("assistant", "Thinking…");
      submit.disabled = true;
      submit.textContent = "Routing…";
      setStatus("CALLING MODEL", "bg-blue-950 text-blue-300");

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + code
          },
          body: JSON.stringify({
            prompt,
            route,
            messages: [...conversation, { role: "user", content: prompt }]
          })
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) throw new Error(result.error || "The request failed.");

        pendingMessage.textContent = result.answer;
        conversation.push({ role: "user", content: prompt });
        conversation.push({ role: "assistant", content: result.answer });
        if (conversation.length > 12) conversation.splice(0, conversation.length - 12);
        promptInput.value = "";
        $("try-model").textContent = result.model || modelName;
        const usage = result.usage;
        const prices = state.prices?.[route] || {};
        const inputTokens = Number(usage?.prompt_tokens) || 0;
        const outputTokens = Number(usage?.completion_tokens) || 0;
        const estimatedCost = (
          inputTokens * (Number(prices.in_per_1m) || 0) +
          outputTokens * (Number(prices.out_per_1m) || 0)
        ) / 1_000_000;
        $("try-usage").textContent = usage
          ? `${inputTokens} input · ${outputTokens} output tokens · about $${estimatedCost.toFixed(5)} at data/prices.json rates`
          : "Usage details were not returned.";
        setStatus("ANSWER READY", "bg-emerald-950 text-emerald-300");
      } catch (error) {
        pendingMessage.textContent = error.message || "The live request failed.";
        pendingMessage.classList.add("border-red-800", "text-red-200");
        userMessage.classList.add("opacity-70");
        $("try-model").textContent = "No answer returned";
        $("try-usage").textContent = "";
        setStatus("REQUEST FAILED", "bg-red-950 text-red-300");
      } finally {
        submit.disabled = false;
        submit.textContent = "Route";
      }
    });
  });
})();
