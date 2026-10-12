/*
 * Alexa+ x ChipLoop, local simulated path, 2026-10-11.
 * MIT. Deterministic JavaScript adaptation of the public ChipLoop synthetic demo.
 * No Alexa+ SDK, remote model, real experiment or clinical rule is invoked.
 */
(function (root) {
  "use strict";

  const VERSION = "1.0.0-local-simulation";
  const BETA = 1.645;
  const PENALTY = 2;
  const BUDGET = 24;
  const INITIAL_INDICES = [0, 22, 49, 71, 91, 110, 127, 143];
  const LABEL = "Synthetic demo. Non-clinical; physical and clinical validation have not been run. Human review required.";
  const clamp = (x, low, high) => Math.min(high, Math.max(low, x));
  const fmt = (x, n = 3) => Number(x).toFixed(n);

  function designGrid() {
    const rows = [];
    for (let i = 0; i < 12; i += 1) {
      const dose = Number(Math.pow(10, -2 + 4 * i / 11).toFixed(6));
      for (const time of [6, 18, 36, 72]) {
        for (const flow of [1, 4, 10]) {
          rows.push({ candidate_id: "C" + String(rows.length + 1).padStart(3, "0"), drug: "DEMO_COMPOUND", dose_uM: dose, time_h: time, flow_uL_min: flow });
        }
      }
    }
    return rows;
  }

  function encode(row) {
    const x = [Number(row.dose_uM), Number(row.time_h), Number(row.flow_uL_min)];
    if (!x.every(Number.isFinite) || x.some(v => v <= 0) || x[0] < .01 || x[0] > 100 || x[1] > 72 || x[2] > 12) {
      throw new Error("Outside declared positive design envelope.");
    }
    return [(Math.log10(x[0]) + 2) / 4, x[1] / 72, x[2] / 12];
  }

  function syntheticOracle(row) {
    const x = encode(row);
    const exposure = Math.pow(10, x[0] * 4 - 2) * (.4 + .6 * x[1]) / (1 + .7 * x[2]);
    return {
      efficacy: clamp(.92 * exposure / (exposure + 1.6) * (.75 + .25 * x[1]), 0, 1),
      toxicity: clamp(.88 * Math.pow(exposure, 1.25) / (Math.pow(exposure, 1.25) + Math.pow(12, 1.25)), 0, 1)
    };
  }

  function initialState() {
    const candidates = designGrid();
    return {
      candidates,
      observations: INITIAL_INDICES.map(i => ({ ...candidates[i], ...syntheticOracle(candidates[i]), evidence_kind: "synthetic", source_id: "synthetic-demo-v1:" + candidates[i].candidate_id })),
      toxicityCap: .35,
      turns: [],
      version: VERSION,
      evidence_kind: "synthetic",
      physical_validation: "NOT_RUN",
      clinical_validation: "NOT_RUN",
      external_submission: "NOT_SUBMITTED"
    };
  }

  function kernel(a, b) {
    const length = [.30, .40, .50];
    let distance = 0;
    for (let i = 0; i < 3; i += 1) distance += Math.pow((a[i] - b[i]) / length[i], 2);
    return .35 * .35 * Math.exp(-.5 * distance);
  }

  function cholesky(matrix) {
    const n = matrix.length;
    const lower = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        let sum = 0;
        for (let k = 0; k < j; k += 1) sum += lower[i][k] * lower[j][k];
        const value = matrix[i][j] - sum;
        if (i === j && value <= 0) throw new Error("Local covariance is not positive definite.");
        lower[i][j] = i === j ? Math.sqrt(value) : value / lower[j][j];
      }
    }
    return lower;
  }

  function solveLower(lower, vector) {
    const result = [];
    for (let i = 0; i < lower.length; i += 1) {
      let value = vector[i];
      for (let j = 0; j < i; j += 1) value -= lower[i][j] * result[j];
      result[i] = value / lower[i][i];
    }
    return result;
  }

  function solveUpperFromLower(lower, vector) {
    const result = Array(lower.length).fill(0);
    for (let i = lower.length - 1; i >= 0; i -= 1) {
      let value = vector[i];
      for (let j = i + 1; j < lower.length; j += 1) value -= lower[j][i] * result[j];
      result[i] = value / lower[i][i];
    }
    return result;
  }

  function validateState(state) {
    if (!Number.isFinite(state.toxicityCap) || state.toxicityCap <= 0 || state.toxicityCap >= 1) throw new Error("Toxicity cap must be between 0 and 1.");
    if (!state.observations.length) throw new Error("This demo requires synthetic initial observations.");
    const candidateMap = new Map(state.candidates.map(c => [c.candidate_id, c]));
    if (candidateMap.size !== state.candidates.length) throw new Error("Duplicate candidate ID.");
    const seen = new Set();
    for (const row of state.observations) {
      const candidate = candidateMap.get(row.candidate_id);
      if (!candidate || seen.has(row.candidate_id) || row.evidence_kind !== "synthetic" || !row.source_id) throw new Error("Only unique source-labeled synthetic observations are accepted.");
      if (["dose_uM", "time_h", "flow_uL_min"].some(k => Number(row[k]) !== Number(candidate[k])) || row.drug !== candidate.drug) throw new Error("Observation does not match its candidate.");
      if (![row.efficacy, row.toxicity].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("Synthetic endpoints must be in [0,1].");
      seen.add(row.candidate_id);
    }
    state.candidates.forEach(encode);
  }

  function recommend(state, topK = 3) {
    validateState(state);
    const train = state.observations.map(encode);
    const seen = new Set(state.observations.map(o => o.candidate_id));
    const covariance = train.map((a, i) => train.map((b, j) => kernel(a, b) + (i === j ? .04 * .04 + 1e-8 : 0)));
    const lower = cholesky(covariance);
    const alphas = ["efficacy", "toxicity"].map(key => solveUpperFromLower(lower, solveLower(lower, state.observations.map(o => o[key] - .5))));
    const predictions = state.candidates.map(candidate => {
      const q = encode(candidate);
      const cross = train.map(a => kernel(a, q));
      const projected = solveLower(lower, cross);
      const std = Math.sqrt(Math.max(.35 * .35 - projected.reduce((s, v) => s + v * v, 0), 1e-9));
      const means = alphas.map(alpha => clamp(.5 + cross.reduce((s, v, i) => s + v * alpha[i], 0), 0, 1));
      const upper = clamp(means[1] + BETA * std, 0, 1);
      return {
        ...candidate,
        efficacy_mean: means[0],
        toxicity_mean: means[1],
        predictive_std: std,
        toxicity_upper: upper,
        acquisition: means[0] + BETA * std - PENALTY * Math.max(upper - state.toxicityCap, 0),
        risk_flag: upper > state.toxicityCap,
        evidence_kind: "synthetic"
      };
    });
    const available = predictions.filter(p => !seen.has(p.candidate_id));
    const ranked = available.slice().sort((a, b) => b.acquisition - a.acquisition || a.candidate_id.localeCompare(b.candidate_id));
    return { recommendations: ranked.slice(0, topK), predictions, remaining: available.length, observations: seen.size, toxicity_cap: state.toxicityCap, evidence_kind: "synthetic", review_required: true };
  }

  function simulateObservation(state, id) {
    if (state.observations.length >= BUDGET) throw new Error("The synthetic session budget of 24 observations is exhausted.");
    const candidate = state.candidates.find(c => c.candidate_id === id);
    if (!candidate) throw new Error("That condition is not in this synthetic candidate grid.");
    if (state.observations.some(o => o.candidate_id === id)) throw new Error("That condition is already observed in this synthetic session.");
    state.observations.push({ ...candidate, ...syntheticOracle(candidate), evidence_kind: "synthetic", source_id: "synthetic-demo-v1:" + id });
    return recommend(state);
  }

  function classify(prompt) {
    const p = String(prompt || "").trim().toLowerCase();
    if (!p) return "help";
    if (/(?:reset|start over|重置)/.test(p)) return "reset";
    if (/(?:simulate|observe|record|模拟|观测)/.test(p)) return "simulate";
    if (/(?:set|change|lower|raise|设置|调整).*(?:cap|threshold|阈值)/.test(p)) return "set_cap";
    if (/(?:how|explain|work|alexa|logic|方法|解释)/.test(p)) return "explain";
    if (/(?:risk|safe|toxicity|毒|风险)/.test(p)) return "risk";
    if (/(?:status|session|budget|observed|remain|状态|预算)/.test(p)) return "status";
    if (/(?:recommend|next|test|condition|suggest|推荐|下一|条件)/.test(p)) return "recommend";
    return "help";
  }

  function handlePrompt(prompt, state) {
    const intent = classify(prompt);
    const p = String(prompt || "").trim();
    let title = "Local response";
    let answer;
    let details = [];
    try {
      if (intent === "reset") {
        const clean = initialState();
        Object.keys(state).forEach(k => delete state[k]);
        Object.assign(state, clean);
        title = "Demo reset";
        answer = "I restored eight initial synthetic observations and the 0.35 cap.";
      } else if (intent === "set_cap") {
        const match = p.match(/(?:cap|threshold|阈值)[^0-9]*([0-9]*\.?[0-9]+)/i);
        const value = match ? Number(match[1]) : NaN;
        if (!Number.isFinite(value) || value < .10 || value > .70) throw new Error("For this demo, ask to set the cap between 0.10 and 0.70.");
        state.toxicityCap = value;
        const result = recommend(state);
        const best = result.recommendations[0];
        title = "Synthetic cap updated";
        answer = "I set the synthetic toxicity cap to " + fmt(value, 2) + ". " + (best ? "The top condition is now " + best.candidate_id + "." : "No candidates remain.");
      } else if (intent === "simulate") {
        const idMatch = p.match(/\bC\d{1,3}\b/i);
        const before = recommend(state);
        const id = idMatch ? "C" + String(Number(idMatch[0].slice(1))).padStart(3, "0") : before.recommendations[0]?.candidate_id;
        if (!id) throw new Error("No synthetic candidate remains.");
        const result = simulateObservation(state, id);
        title = "Synthetic observation added";
        answer = "I simulated " + id + " locally. You now have " + state.observations.length + " observations and " + result.remaining + " available conditions. " + (result.recommendations[0] ? "The new top condition is " + result.recommendations[0].candidate_id + "." : "The grid is complete.");
      } else if (intent === "explain") {
        title = "Simulated Alexa+ path";
        answer = "I map your text to a small set of local intents, call a deterministic ChipLoop-inspired Gaussian-process scorer, then format a concise reply. The scorer balances predicted response and uncertainty against a toxicity upper-bound penalty. This page does not connect to Alexa+, an LLM, or a real experiment.";
      } else if (intent === "status") {
        const result = recommend(state);
        title = "Synthetic session status";
        answer = "I have " + state.observations.length + " synthetic observations from " + state.candidates.length + " grid conditions; " + result.remaining + " remain. The cap is " + fmt(state.toxicityCap, 2) + ". The local candidate has not been externally submitted.";
      } else if (intent === "risk") {
        const result = recommend(state);
        const idMatch = p.match(/\bC\d{1,3}\b/i);
        const id = idMatch ? "C" + String(Number(idMatch[0].slice(1))).padStart(3, "0") : result.recommendations[0]?.candidate_id;
        const candidate = result.predictions.find(c => c.candidate_id === id);
        if (!candidate) throw new Error("That condition is not in this synthetic grid.");
        title = "Synthetic risk check";
        answer = candidate.candidate_id + " has a model toxicity upper estimate of " + fmt(candidate.toxicity_upper) + " against the " + fmt(state.toxicityCap, 2) + " cap. " + (candidate.risk_flag ? "It is flagged above that reference cap." : "It is below that reference cap, which does not establish biological safety.") + " The interval depends on fixed model assumptions and is not a calibrated safety guarantee.";
        details = candidateDetails(candidate);
      } else if (intent === "recommend") {
        const result = recommend(state);
        const candidate = result.recommendations[0];
        title = "Synthetic next condition";
        answer = candidate ? "I suggest reviewing " + candidate.candidate_id + ": " + fmt(candidate.dose_uM) + " micromolar, " + candidate.time_h + " hours, and " + candidate.flow_uL_min + " microliters per minute. Its synthetic predicted response is " + fmt(candidate.efficacy_mean) + ", and its toxicity upper estimate is " + fmt(candidate.toxicity_upper) + ". " + (candidate.risk_flag ? "It is flagged above the " + fmt(state.toxicityCap, 2) + " reference cap." : "It is below the " + fmt(state.toxicityCap, 2) + " reference cap.") + " The ranking is a review prompt; it does not run or approve an experiment." : "No synthetic candidates remain.";
        if (candidate) details = candidateDetails(candidate);
      } else {
        title = "Requests supported locally";
        answer = "Try: What should I test next? What is the risk? How does this demo work? What is the session status? You can also ask to simulate observing C042 or set the cap to 0.30. I only route these bounded local intents.";
      }
    } catch (error) {
      title = "Local request needs revision";
      answer = error.message;
    }
    const response = { intent, title, answer: answer + " " + LABEL, details, evidence_kind: "synthetic", clinical_validation: "NOT_RUN", physical_validation: "NOT_RUN", review_required: true };
    state.turns.push({ turn: state.turns.length + 1, request: p || "(empty)", intent, answer: response.answer, observed: state.observations.length, cap: state.toxicityCap });
    return response;
  }

  function candidateDetails(c) {
    return [
      ["Condition", c.candidate_id], ["Predicted response", fmt(c.efficacy_mean)], ["Toxicity upper", fmt(c.toxicity_upper)],
      ["Dose (µM)", fmt(c.dose_uM)], ["Time (hours)", c.time_h], ["Flow (µL/min)", c.flow_uL_min]
    ];
  }

  function selfTest() {
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, status: pass ? "PASS" : "FAIL", detail });
    const state = initialState();
    const initial = recommend(state);
    check("synthetic_grid_and_initial_observations", state.candidates.length === 144 && state.observations.length === 8, { candidates: state.candidates.length, observations: state.observations.length });
    check("public_snapshot_top_candidate", initial.recommendations[0].candidate_id === "C104", { id: initial.recommendations[0].candidate_id, upper: initial.recommendations[0].toxicity_upper });
    check("public_snapshot_numeric_match", Math.abs(initial.recommendations[0].toxicity_upper - .3511706350246385) < 1e-10, { absolute_tolerance: 1e-10 });
    for (const [prompt, intent] of [["What should I test next?", "recommend"], ["What is the risk?", "risk"], ["How does this demo work?", "explain"], ["What is the session status?", "status"]]) {
      const response = handlePrompt(prompt, state);
      check("intent_" + intent, response.intent === intent && response.answer.includes("Synthetic demo.") && response.answer.includes("Non-clinical"), { intent: response.intent });
    }
    const first = handlePrompt("Recommend a next condition", initialState()).answer;
    const second = handlePrompt("Recommend a next condition", initialState()).answer;
    check("deterministic_fresh_session_reply", first === second, { exact_match: first === second });
    handlePrompt("Simulate observing C042", state);
    const after = recommend(state);
    check("synthetic_observation_update", state.observations.length === 9 && after.remaining === 135 && !after.recommendations.some(c => c.candidate_id === "C042"), { observations: state.observations.length, remaining: after.remaining });
    handlePrompt("Set the cap to 0.30", state);
    check("bounded_cap_update", state.toxicityCap === .30, { cap: state.toxicityCap });
    handlePrompt("Set the cap to 2", state);
    check("invalid_cap_rejected_without_mutation", state.toxicityCap === .30, { cap: state.toxicityCap });
    const serialized = JSON.stringify(state);
    check("synthetic_provenance_and_not_submitted", serialized.includes('"evidence_kind":"synthetic"') && state.external_submission === "NOT_SUBMITTED", { external_submission: state.external_submission });
    return { overall: checks.every(c => c.status === "PASS") ? "PASS" : "FAIL", checks };
  }

  const API = { VERSION, LABEL, designGrid, encode, syntheticOracle, initialState, recommend, simulateObservation, classify, handlePrompt, selfTest };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
    if (typeof require !== "undefined" && require.main === module && process.argv.includes("--self-test")) {
      const result = selfTest();
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exitCode = result.overall === "PASS" ? 0 : 1;
    }
  }
  if (typeof document === "undefined") return;
  root.ChipLoopAlexaSimulation = API;

  const $ = id => document.getElementById(id);
  const state = initialState();
  let lastAnswer = "Ready for a local synthetic request. " + LABEL;
  function renderStatus() {
    const result = recommend(state);
    $("observed").textContent = state.observations.length;
    $("remaining").textContent = result.remaining;
    $("cap").textContent = fmt(state.toxicityCap, 2);
    $("meter").style.width = Math.min(100, state.observations.length / BUDGET * 100) + "%";
    $("meter-note").textContent = state.observations.length + " / " + BUDGET + " synthetic observation budget. No real experiment is executed.";
    $("audit").replaceChildren(...state.turns.slice().reverse().slice(0, 10).map(turn => {
      const item = document.createElement("li");
      item.textContent = "#" + turn.turn + " " + turn.intent + " · " + turn.observed + " synthetic observations · cap " + fmt(turn.cap, 2);
      return item;
    }));
    if (!state.turns.length) {
      const item = document.createElement("li");
      item.textContent = "Loaded eight source-labeled synthetic observations.";
      $("audit").append(item);
    }
  }
  function renderResponse(response) {
    lastAnswer = response.answer;
    const responseHead = document.createElement("div");
    responseHead.className = "response-head";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "A";
    const titles = document.createElement("div");
    const title = document.createElement("div");
    title.className = "response-title";
    title.textContent = response.title;
    const subtitle = document.createElement("small");
    subtitle.textContent = "Synthetic response · non-clinical · review required";
    titles.append(title, subtitle);
    responseHead.append(avatar, titles);
    const body = document.createElement("p");
    body.className = "response-body";
    body.textContent = response.answer;
    $("response").replaceChildren(responseHead, body);
    if (response.details.length) {
      const grid = document.createElement("div");
      grid.className = "detail-grid";
      for (const [label, value] of response.details) {
        const box = document.createElement("div");
        box.className = "detail";
        const labelElement = document.createElement("span");
        labelElement.textContent = label;
        const valueElement = document.createElement("strong");
        valueElement.textContent = value;
        box.append(labelElement, valueElement);
        grid.append(box);
      }
      $("response").append(grid);
    }
    renderStatus();
  }
  function ask(prompt) { renderResponse(handlePrompt(prompt, state)); }
  $("prompt-form").addEventListener("submit", event => { event.preventDefault(); ask($("prompt").value); });
  document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => { $("prompt").value = button.dataset.prompt; ask(button.dataset.prompt); }));
  $("reset").addEventListener("click", () => { $("prompt").value = ""; ask("Reset demo"); });
  $("export").addEventListener("click", () => {
    const exported = { generated_at: new Date().toISOString(), path: "Alexa+ simulated local experience", ...state, result: recommend(state), audit_notice: "Editable browser state, not a platform receipt." };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "alexa_chiploop_synthetic_session.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("speak").addEventListener("click", () => {
    if (!("speechSynthesis" in root) || !("SpeechSynthesisUtterance" in root)) {
      renderResponse({ title: "Browser speech unavailable", answer: "This browser does not expose speech synthesis. The text path remains usable. " + LABEL, details: [] });
      return;
    }
    root.speechSynthesis.cancel();
    const utterance = new root.SpeechSynthesisUtterance(lastAnswer);
    utterance.lang = "en-US";
    root.speechSynthesis.speak(utterance);
  });
  renderStatus();
})(typeof globalThis !== "undefined" ? globalThis : this);
