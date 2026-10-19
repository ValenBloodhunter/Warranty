(function () {
  "use strict";

  const ACCESS_CODE_KEY = "warranty-demo-access-code";
  const MODELS = {
    low: { title: "Low · GPT-OSS 20B", model: "openai/gpt-oss-20b" },
    good: { title: "Good · GPT-6 Luna", model: "openai/gpt-6-luna" },
    best: { title: "Best · GPT-6 Astra", model: "openai/gpt-6-astra" }
  };
  const PRICES = {
    low: { input: 0.018, output: 0.09 },
    good: { input: 0.10, output: 0.50 },
    best: { input: 10, output: 50 }
  };
  const $ = id => document.getElementById(id);
  let selectedTier = "auto";
  let recommendedTier = "low";
  const conversation = [];

  const patterns = {
    highRisk: /\b(medical|medicine|diagnos(?:e|is|tic)|treatment|dosage|legal|lawsuit|contract|financial advice|invest(?:ment|ing)|tax advice|safety|emergency|suicid|self[- ]harm|security exploit|vulnerability)\b/i,
    coding: /\b(code|coding|program|programming|debug|bug|function|algorithm|sql|api|script|compiler|typescript|javascript|python|rust|java|architecture|refactor|stack trace)\b/i,
    math: /\b(math|calculate|equation|proof|probability|statistics|integral|derivative|matrix|regression|optimization|optimi[sz]e)\b/i,
    research: /\b(research|sources|cite|citation|evidence|compare|contrast|trade[- ]?offs|literature|evaluate|analy[sz]e|investigate)\b/i,
    reasoning: /\b(step[- ]by[- ]step|reason|reasoning|derive|prove|plan|strategy|multi[- ]step|why|root cause|complicated|complex)\b/i,
    writing: /\b(write|rewrite|draft|edit|summari[sz]e|email|story|essay|tone|translate|proofread)\b/i,
    constraints: /\b(must|exactly|unless|while|at least|no more than|in order to|given that|subject to|constraints?)\b/i
  };

  function analysePrompt(raw) {
    const prompt = raw.trim();
    if (!prompt) return null;
    const words = prompt.match(/[\p{L}\p{N}_'-]+/gu) || [];
    const uniqueTasks = (prompt.match(/\b(and then|also|plus|first|second|finally|step\s*\d)\b/gi) || []).length;
    const signals = [];
    let score = 13;
    let type = "General question";
    let explanation = "A direct request with few visible reasoning steps.";
    const matches = key => patterns[key].test(prompt);

    if (words.length > 28) { score += 8; signals.push("Longer context"); }
    if (words.length > 70) { score += 8; signals.push("Detailed prompt"); }
    if (matches("coding")) { score += 23; signals.push("Code or systems"); type = "Software & systems"; explanation = "The request contains code or engineering language."; }
    if (matches("math")) { score += 22; signals.push("Quantitative reasoning"); type = "Math & analysis"; explanation = "The request includes calculation or formal reasoning cues."; }
    if (matches("research")) { score += 17; signals.push("Evidence seeking"); type = "Research & comparison"; explanation = "The request asks for analysis, sources, or comparison."; }
    if (matches("reasoning")) { score += 15; signals.push("Multi-step reasoning"); if (type === "General question") type = "Reasoning & planning"; explanation = "The request suggests multiple reasoning steps."; }
    if (matches("writing") && type === "General question") { type = "Writing & language"; explanation = "The request is mainly about writing or language."; }
    if (matches("constraints")) { score += 10; signals.push("Specific constraints"); }
    if (uniqueTasks > 1) { score += 8; signals.push("Multiple tasks"); }
    const highRisk = matches("highRisk");
    if (highRisk) { score += 35; signals.push("High-impact topic"); type = "High-impact decision"; explanation = "The request touches a high-impact topic; check reliable sources and expert advice."; }
    score = Math.max(8, Math.min(100, score));

    return { prompt, words: words.length, score, signals: signals.slice(0, 4), type, explanation, highRisk };
  }

  function chooseTier(analysis, accuracy) {
    if (!analysis) return "low";
    if (analysis.highRisk) return "best";
    if (accuracy >= 99) return "best";
    const pressure = Math.max(-10, Math.min(20, (accuracy - 85) * 0.75));
    const score = analysis.score + pressure;
    if (score >= 65) return "best";
    if (score >= 34 || accuracy >= 93) return "good";
    return "low";
  }

  function tierTitle(tier) {
    return tier === "low" ? "Low" : tier === "good" ? "Good" : "Best";
  }

  function setStatus(label, state) {
    const status = $("connection-label");
    const dot = document.querySelector(".status-dot");
    if (status) status.textContent = label;
    if (dot) dot.dataset.state = state || "ready";
  }

  function updateTierSelection() {
    const accuracy = Number($("accuracy-slider").value);
    const analysis = analysePrompt($("try-prompt").value);
    recommendedTier = chooseTier(analysis, accuracy);
    document.querySelectorAll(".tier-option").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.tier === selectedTier));
    });
    const activeTier = selectedTier === "auto" ? recommendedTier : selectedTier;
    document.querySelectorAll("[data-visual-tier]").forEach(node => {
      node.classList.toggle("is-active", node.dataset.visualTier === activeTier);
    });
    document.querySelectorAll("[data-tier-card]").forEach(card => {
      card.classList.toggle("is-recommended", card.dataset.tierCard === recommendedTier);
      card.classList.toggle("is-selected", selectedTier === card.dataset.tierCard);
    });

    const picked = selectedTier === "auto" ? recommendedTier : selectedTier;
    const recommendation = $("recommended-tier");
    if (recommendation) recommendation.textContent = analysis
      ? tierTitle(recommendedTier) + " · " + MODELS[recommendedTier].model
      : "Add a question";
    const why = $("recommendation-reason");
    if (why) {
      why.textContent = !analysis
        ? "Your route will update as we read your task."
        : selectedTier === "auto"
          ? "Selected from task signals and your accuracy preference."
          : "Manual choice: " + tierTitle(selectedTier) + ". Auto recommendation: " + tierTitle(recommendedTier) + ".";
    }
    const mark = $("recommendation-mark");
    if (mark) mark.textContent = selectedTier === "auto" ? "AUTO" : "MANUAL";
    const submitLabel = $("submit-label");
    if (submitLabel) submitLabel.textContent = analysis ? "Route with " + tierTitle(picked) : "Enter a question";
    const visual = $("route-visual");
    if (visual) visual.dataset.activeTier = picked;
  }

  function updateReadout() {
    const prompt = $("try-prompt").value;
    const analysis = analysePrompt(prompt);
    const count = $("char-count");
    if (count) count.textContent = String(prompt.length);
    const intentType = $("intent-type");
    const intentReason = $("intent-reason");
    const fill = $("difficulty-fill");
    const level = $("difficulty-label");
    const signals = $("signal-list");
    if (!analysis) {
      if (intentType) intentType.textContent = "Waiting for your question";
      if (intentReason) intentReason.textContent = "We’ll look for task type, complexity, and risk signals.";
      if (fill) fill.style.width = "0%";
      if (level) level.textContent = "—";
      if (signals) signals.innerHTML = '<span class="signal-placeholder">Signals appear as you type</span>';
    } else {
      if (intentType) intentType.textContent = analysis.type;
      if (intentReason) intentReason.textContent = analysis.explanation;
      if (fill) fill.style.width = analysis.score + "%";
      if (level) level.textContent = analysis.score < 34 ? "LIGHT" : analysis.score < 65 ? "LAYERED" : "DEEP";
      if (signals) {
        signals.replaceChildren();
        (analysis.signals.length ? analysis.signals : ["Direct request"]).forEach(signal => {
          const chip = document.createElement("span");
          chip.className = "signal-chip";
          chip.textContent = signal;
          signals.appendChild(chip);
        });
      }
    }
    updateTierSelection();
  }

  function addMessage(role, text, extraClass) {
    const message = document.createElement("div");
    message.className = "message message-" + role + (extraClass ? " " + extraClass : "");
    message.textContent = text;
    $("try-thread").appendChild(message);
    message.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return message;
  }

  function money(value) {
    if (value < 0.00001) return "<$0.00001";
    return "$" + value.toFixed(value < 0.01 ? 5 : 4);
  }

  function readStoredCode() {
    try { $("try-access-code").value = sessionStorage.getItem(ACCESS_CODE_KEY) || ""; } catch (_) { /* Storage is optional. */ }
  }

  async function checkApi() {
    try {
      const response = await fetch("/api/chat", { cache: "no-store" });
      if (!response.ok) throw new Error("API unavailable");
      const health = await response.json();
      if (health.ready) {
        setStatus("LIVE MODELS CONNECTED", "ready");
        $("access-note").textContent = "Live models are connected. Your code is held for this tab only.";
      } else {
        setStatus("MODEL KEYS NEEDED", "warning");
        $("access-note").textContent = "The router is ready. Live answers need provider credentials configured on the server.";
      }
    } catch (_) {
      setStatus("ROUTER PREVIEW", "warning");
      $("access-note").textContent = "Live calls need the deployed API and server credentials. The question scan works in preview.";
    }
  }

  function renderFailure(error, pending) {
    pending.classList.add("message-error");
    pending.textContent = error.message || "The model request failed.";
    $("answer-status").textContent = "REQUEST FAILED";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const prompt = $("try-prompt");
    const slider = $("accuracy-slider");
    const access = $("try-access-code");
    const form = $("try-form");
    const submit = $("try-submit");
    const answerZone = $("answer-zone");
    if (!prompt || !slider || !form || !submit) return;

    readStoredCode();
    checkApi();
    updateReadout();

    prompt.addEventListener("input", updateReadout);
    prompt.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") form.requestSubmit();
    });
    slider.addEventListener("input", () => {
      $("accuracy-value").textContent = slider.value;
      updateTierSelection();
    });
    document.querySelectorAll("[data-example]").forEach(button => {
      button.addEventListener("click", () => {
        prompt.value = button.dataset.example;
        prompt.focus();
        prompt.setSelectionRange(prompt.value.length, prompt.value.length);
        updateReadout();
      });
    });
    document.querySelectorAll(".tier-option").forEach(button => {
      button.addEventListener("click", () => {
        selectedTier = button.dataset.tier;
        updateTierSelection();
      });
    });
    $("try-clear").addEventListener("click", () => {
      conversation.length = 0;
      $("try-thread").replaceChildren();
      answerZone.hidden = true;
      $("answer-meta").textContent = "";
      $("try-usage").textContent = "";
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const text = prompt.value.trim();
      if (!text) { prompt.focus(); return; }
      if (!access.value.trim()) {
        $("answer-title").textContent = "Access code required";
        $("answer-status").textContent = "NEEDS ACCESS";
        $("answer-meta").textContent = "Enter the demo access code supplied by the site owner to request a live answer.";
        answerZone.hidden = false;
        access.focus();
        return;
      }
      try { sessionStorage.setItem(ACCESS_CODE_KEY, access.value.trim()); } catch (_) { /* Session storage is optional. */ }

      const analysis = analysePrompt(text);
      const accuracy = Number(slider.value);
      const tier = selectedTier === "auto" ? chooseTier(analysis, accuracy) : selectedTier;
      const model = MODELS[tier];
      $("answer-title").textContent = "The answer is on its way";
      $("answer-status").textContent = "ROUTING";
      $("answer-meta").textContent = `${tierTitle(tier)} · ${model.model} · ${analysis.type} · accuracy preference ${accuracy}/100`;
      answerZone.hidden = false;
      const userMessage = addMessage("user", text);
      const pending = addMessage("assistant", "Connecting to " + tierTitle(tier) + "…");
      submit.disabled = true;
      $("submit-label").textContent = "Thinking…";
      setStatus("MODEL WORKING", "working");

      try {
        const messages = [...conversation, { role: "user", content: text }].slice(-12);
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + access.value.trim() },
          body: JSON.stringify({ prompt: text, tier, accuracyPreference: accuracy, taskType: analysis.type, messages })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = response.status === 503
            ? "Live answers are not connected yet. Add OPENROUTER_API_KEY and WARRANTY_DEMO_TOKEN to this Vercel project, then redeploy."
            : result.error || "The model request failed.";
          throw new Error(message);
        }
        const answerText = typeof result.answer === "string" ? result.answer : "The model returned no text.";
        pending.textContent = answerText;
        conversation.push({ role: "user", content: text }, { role: "assistant", content: answerText });
        if (conversation.length > 12) conversation.splice(0, conversation.length - 12);
        const usage = result.usage || {};
        const inputTokens = Number(usage.prompt_tokens) || 0;
        const outputTokens = Number(usage.completion_tokens) || 0;
        const cost = (inputTokens * PRICES[tier].input + outputTokens * PRICES[tier].output) / 1_000_000;
        $("answer-title").textContent = "Your answer";
        $("answer-status").textContent = "COMPLETE";
        $("answer-meta").textContent = `${result.model || model.model} · ${tierTitle(tier)} tier`;
        $("try-usage").textContent = usage.prompt_tokens == null
          ? "Token usage was not returned by the provider."
          : `${inputTokens} input · ${outputTokens} output tokens · estimated ${money(cost)} at listed model rates`;
        prompt.value = "";
        updateReadout();
        setStatus("ANSWER READY", "ready");
      } catch (error) {
        renderFailure(error, pending);
        userMessage.classList.add("message-user-muted");
        setStatus("MODEL REQUEST FAILED", "warning");
      } finally {
        submit.disabled = false;
        updateTierSelection();
      }
    });

    const scene = $("route-visual");
    if (scene && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      scene.addEventListener("pointermove", event => {
        const rect = scene.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - .5;
        const y = (event.clientY - rect.top) / rect.height - .5;
        scene.style.setProperty("--tilt-x", `${(-y * 3.5).toFixed(2)}deg`);
        scene.style.setProperty("--tilt-y", `${(x * 4).toFixed(2)}deg`);
        scene.classList.add("is-tilting");
      });
      scene.addEventListener("pointerleave", () => scene.classList.remove("is-tilting"));
    }
  });
})();
