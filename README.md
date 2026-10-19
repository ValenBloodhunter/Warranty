# WARRANTY

## A Cost-Optimising LLM Router with a Statistical Quality Guarantee

WARRANTY is an LLM router with three live model tiers—Low, Good, and Best—and a separate offline benchmark simulator. In the live interface, a local heuristic estimates task type and complexity, then combines that estimate with the user's accuracy preference. Users can follow the recommendation or choose a tier themselves.

The offline simulator studies a different two-model policy and uses a 95% confidence certification procedure. That certificate applies only to its benchmark data and does not guarantee the quality of live requests.

---

## The Problem

LLM routing systems can significantly reduce inference costs by deciding whether a query should be handled by a cheaper model or a more capable model.

The problem is that cost savings alone do not prove that quality has been preserved.

A router may send more and more queries to a cheap model and report lower costs while silently introducing additional incorrect answers.

WARRANTY treats quality as a constraint rather than simply another metric:

> **The user sets the maximum acceptable regression. WARRANTY finds the cheapest routing policy that can be statistically certified to stay within that limit.**

---

## How It Works

### 1. Estimate Query Difficulty

Each query is converted into a 128-dimensional TF-IDF/SVD vector.

WARRANTY compares the query against labelled historical queries using cosine similarity and k-nearest neighbours.

For the 20 nearest neighbours, it calculates a similarity-weighted estimate:

$$
\hat p(x)=
\frac{\sum_i s_i y_i}
{\sum_i s_i}
$$

where:

* \(s_i\) is the cosine similarity to neighbour \(i\)
* \(y_i=1\) when the cheap model was correct
* \(y_i=0\) when the cheap model was incorrect

This produces \(\hat p\), the estimated probability that the cheap model will answer the query correctly.

### 2. Learn a Certified Threshold

The user chooses a maximum acceptable regression budget:

$$
\varepsilon
$$

WARRANTY evaluates candidate routing thresholds \(\tau\) using a held-out calibration set.

A query is routed to the cheap model when:

$$
\hat p(x)\geq\tau
$$

Otherwise it is sent to the frontier model.

The system searches for the most aggressive threshold that passes a one-sided binomial test at 95% confidence.

The certification test evaluates whether the observed regression count is compatible with the chosen regression budget.

### 3. Define Regression

A regression occurs when:

$$
\text{Cheap model = wrong}
$$

while:

$$
\text{Frontier model = correct}
$$

Therefore:

$$
L_i =
\mathbf{1}
[\text{cheap wrong AND frontier correct}]
$$

This focuses the quality metric on mistakes actually caused by choosing the cheaper model.

### 4. Verify and Escalate

Cheap-routed answers can be checked using additional signals from the cheap model:

* Self-consistency
* Self-rated confidence

The verification score is:

$$
q =
\text{self-consistency}
\times
\frac{\text{self-rating}}{100}
$$

If:

$$
q < 0.5
$$

the query is escalated to the frontier model.

### 5. Cache and Audit

Exact duplicate queries can be served from the cache without another model call.

WARRANTY also continuously audits a sample of cheap-routed traffic.

The audit uses a Wilson 95% confidence interval to estimate the live regression rate.

If the observed regression rate exceeds the allowed budget, the router can enter a suspended state and increase its threshold, becoming more conservative.

---

## Mathematical Objective

The central optimisation problem is:

$$
\boxed{
\min_{\tau} C(\tau)
}
$$

subject to:

$$
\boxed{
R(\tau)\leq\varepsilon
}
$$

with a statistical confidence level of:

$$
1-\delta=0.95
$$

where:

* \(C(\tau)\) is the routing cost
* \(R(\tau)\) is the regression risk
* \(\varepsilon\) is the user's maximum acceptable regression budget
* \(\tau\) is the routing threshold

In simple terms:

> **Minimise cost subject to a statistically controlled quality-regression constraint.**

---

## System Architecture

```text
                     USER QUERY
                          |
                          v
                 Query Vectorisation
                          |
                          v
                 kNN Difficulty Model
                          |
                          v
                       p-hat
                          |
                          v
              Certified Threshold tau
                    /             \
                   /               \
             p-hat >= tau       p-hat < tau
                 |                   |
                 v                   v
           CHEAP MODEL         FRONTIER MODEL
                 |
                 v
          Verification
                 |
          +------+------+
          |             |
       confident     uncertain
          |             |
          v             v
       ACCEPT        ESCALATE
          |             |
          +------+------+
                 |
                 v
             FINAL ANSWER
                 |
                 v
             LIVE AUDIT
                 |
                 v
          Drift Detection
```

---

## Certification

For a calibration set of \(n\) queries, let \(k\) be the number of observed regressions at a particular threshold.

The binomial probability used by the certification procedure is:

$$
P(X\leq k)
=
\sum_{j=0}^{k}
{n\choose j}
\varepsilon^j
(1-\varepsilon)^{n-j}
$$

with:

$$
X\sim\text{Binomial}(n,\varepsilon)
$$

and:

$$
\delta=0.05
$$

The system evaluates candidate thresholds and selects the most aggressive threshold that passes the certification procedure.

If no threshold can be certified, WARRANTY refuses to optimise and routes traffic to the frontier model.

---

## Benchmark

The current benchmark is designed around 500 queries:

| Slice            | Queries |
| ---------------- | ------: |
| Math             |     200 |
| Multiple Choice  |     200 |
| Customer Support |     100 |
| Total            |     500 |

The data is divided into:

| Split       | Queries |
| ----------- | ------: |
| Train       |     150 |
| Calibration |     175 |
| Test        |     175 |
| Total       |     500 |

The train split is used for the kNN difficulty estimator.

The calibration split is used to select and certify the routing threshold.

The test split is reserved for evaluating routing performance and comparisons.

The benchmark uses a fixed random seed of 42 for the split.

The math and multiple-choice portions use hard ground truth. The customer-support portion uses a separate LLM-based evaluation and is reported separately.

---

## Baselines

WARRANTY is evaluated against several simple routing strategies:

1. Always use the frontier model
2. Always use the cheap model
3. Random 50/50 routing
4. Query-length heuristic using the median query length
5. Fixed uncalibrated threshold of 0.7
6. WARRANTY
7. WARRANTY + verification
8. WARRANTY + verification + exact-match cache

The comparisons are performed on the held-out test split.

---

## Cost Model

For a model \(m\), inference cost is calculated from input and output tokens:

$$
C_m=
\frac{
T_{in}P_{in,m}
+
T_{out}P_{out,m}
}{10^6}
$$

where:

* \(T_{in}\) = input tokens
* \(T_{out}\) = output tokens
* \(P_{in,m}\) = input price per million tokens
* \(P_{out,m}\) = output price per million tokens

Cost savings are reported relative to routing every query to the frontier model.

---

## Live Drift Response

The certification is based on calibration data, so changing production traffic can invalidate the assumptions behind the learned threshold.

WARRANTY therefore treats the certificate as something that must be continuously monitored.

During live auditing:

$$
\hat R = \frac{k}{n}
$$

is estimated over recently audited samples.

A Wilson 95% confidence interval is maintained around the observed regression rate.

When the live rate becomes unsafe, the system:

1. Detects the increase in regression.
2. Suspends the current certificate.
3. Raises the routing threshold.
4. Sends more traffic to the frontier model.
5. Continues auditing.
6. Recovers certification when the observed risk returns below the allowed budget.

The project includes a simulated drift mode demonstrating this behaviour.

---

## Implementation

WARRANTY is a responsive model-routing interface with an interactive 3D route visual, a transparent question scan, and three live model tiers. The scan labels task cues and estimates complexity; it is a lightweight heuristic, not a calibrated accuracy predictor. The user can set an accuracy preference or choose a tier manually.

### Frontend

* HTML, custom CSS, and vanilla JavaScript
* CSS 3D and motion effects with reduced-motion support
* Vercel Function at `api/chat.js`

### Data and Evaluation

* Python
* Google Colab
* Hugging Face datasets
* scikit-learn
* TF-IDF
* Truncated SVD

### Models

The router has three server-side model tiers. Their default IDs and listed rates are in `data/prices.json`:

| Tier | Model | Input / 1M tokens | Output / 1M tokens |
| --- | --- | ---: | ---: |
| Low | `openai/gpt-oss-20b` | $0.018 | $0.09 |
| Good | `openai/gpt-6-luna` | $0.10 | $0.50 |
| Best | `openai/gpt-6-astra` | $10.00 | $50.00 |

Rates can change. The Best tier is substantially more expensive, so automatic routing only selects it for high complexity or high-impact prompts. The slider is a preference that influences the heuristic; it is not an accuracy guarantee.

### Storage and live requests

The benchmark is stored locally in:

```text
data/bank.json
```

The offline benchmark data supports the research simulator. The live interface separately scans task type, complexity, and high-impact cues, then combines that scan with the user's accuracy preference. Users can accept the recommended tier or manually select Low, Good, or Best. The selected tier is sent to `/api/chat`, which calls OpenRouter and returns the answer, model ID, and token usage.

The live scan is a heuristic and does not assess the eventual answer's correctness. Offline benchmark certification does not certify the three-tier live route or guarantee correctness on live prompts.

### Credentials and access

The app does not have individual user accounts. Live requests require a shared demo access code and a server-side OpenRouter API key:

* `WARRANTY_DEMO_TOKEN` is checked by the function against the browser's `Authorization: Bearer` header. The browser keeps the code in `sessionStorage` for the current tab session.
* `OPENROUTER_API_KEY` is used only by `api/chat.js`; it is never sent to the browser.
* `WARRANTY_LOW_MODEL`, `WARRANTY_GOOD_MODEL`, and `WARRANTY_BEST_MODEL` can override the model IDs in `data/prices.json`.

The access code is shared by everyone you give it to; it identifies authorized demo access, not an individual user. Use HTTPS, keep the code private, and rotate it if it is shared too widely.

---

## Repository Structure

```text
warranty/
├── README.md
├── index.html
├── api/
│   └── chat.js
├── css/
│   └── studio.css
├── .gitignore
├── .env.example
│
├── js/
│   ├── router.js
│   ├── certify.js
│   ├── ui.js
│   ├── charts.js
│   ├── replay.js
│   ├── trace.js
│   ├── judge.js
│   └── live.js
│
├── data/
│   ├── questions.json
│   ├── bank.sample.json
│   ├── bank.json
│   ├── prices.json
│   └── questions copy.json
```

---

## Running the Project

### Option 1: Vercel

Add `OPENROUTER_API_KEY` and `WARRANTY_DEMO_TOKEN` in the Vercel project's Environment Variables, then deploy. Enter the shared demo access code in the router panel. A `GET /api/chat` health check reports whether both server values are configured without exposing either value.

### Option 2: Local

Clone the repository, copy `.env.example` to `.env.local`, fill in both secrets, and run the app with the Vercel CLI:

```text
vercel dev
```

The application loads:

```text
data/bank.json
data/prices.json
```

The question scan and model-tier controls work in the browser. Live requests go through the server function; the provider key stays server-side. Run through `vercel dev` for live calls. The live interface explains when the server-side model connection has not been configured.

---

## What the Dashboard Shows

The interface provides:

* User-defined regression budget
* Certification status
* Learned routing threshold
* Cost savings
* Percentage of queries routed cheaply
* Measured regression
* Verification overhead
* Routing flow distribution
* Pareto comparison against baselines
* Ablation results
* Live audit gauge
* Replay mode
* Simulated drift injection
* Decision traces
* Judge Mode

---

## Limitations

### Marginal Guarantee

The statistical guarantee is a distribution-level or marginal guarantee. It does not guarantee that every individual query will be correct.

### Distribution Shift

The calibration procedure assumes that future traffic is sufficiently similar to the calibration distribution.

Production drift can violate this assumption.

WARRANTY addresses this with continuous auditing and adaptive threshold tightening, but the audit mechanism does not mathematically eliminate distribution shift.

### LLM-Judged Support Data

Customer-support questions are evaluated separately using an LLM judge rather than hard ground truth.

These results should therefore be interpreted separately from the exact-match math and multiple-choice results.

### Scaling

The current kNN implementation operates over an in-memory dataset.

At production scale, this would need to be replaced or extended with a proper vector database or approximate nearest-neighbour index.

### Verification Cost

Verification improves safety but adds additional inference cost and latency.

These costs are explicitly included in the evaluation rather than hidden from the reported results.

---

## Prior Work

WARRANTY builds on existing research in:

* LLM routing and model cascades
* RouteLLM-style model selection
* Learn-then-Test statistical risk control
* Conformal risk control
* Conformal prediction and adaptive model selection
* Recent work on statistically controlled LLM cascades

The contribution of this project is not the invention of each individual statistical component.

The goal is to combine these ideas into a deployable routing console with:

1. A user-controlled quality budget.
2. A statistically selected routing threshold.
3. Cost-aware routing.
4. Verification and escalation.
5. Continuous auditing.
6. Simulated drift detection and recovery.
7. An interpretable decision trace.

The central idea is to treat the quality guarantee as **perishable** rather than assuming that a threshold learned once will remain safe forever.

---

## Results

Results from the final benchmark will be inserted below.

| Configuration             | Cost / 1K | Accuracy | Regression | Certified |
| ------------------------- | --------: | -------: | ---------: | --------- |
| Always Frontier           |         — |        — |          — | —         |
| Always Cheap              |         — |        — |          — | —         |
| Random 50/50              |         — |        — |          — | —         |
| Length Heuristic          |         — |        — |          — | —         |
| Fixed Threshold 0.7       |         — |        — |          — | —         |
| WARRANTY                  |         — |        — |          — | —         |
| WARRANTY + Verify         |         — |        — |          — | —         |
| WARRANTY + Verify + Cache |         — |        — |          — | —         |

---

## Project Goal

The objective of WARRANTY is simple:

> **Spend as little as possible while maintaining a statistically controlled quality-regression budget.**

Instead of asking only:

> "How much money did the router save?"

WARRANTY asks:

> **"How much money can we save while having statistical evidence that we stayed within the quality budget?"**

