# SentinelPay | AI Payment Guardian

SentinelPay is an intelligent, agentic payment security monitoring system that processes transactions through a multi-tier risk evaluation pipeline. It combines deterministic hard/soft policies with an advanced AI reasoning layer (NemoClaw & Gemini) to achieve highly explainable, auditable, and secure payment decisions.

## 📸 Dashboard & Interface

**Live Execution Feed**
![Live Dashboard](docs/screenshots/01-live-dashboard.png)
*A real-time overview of transaction traces, showing their decision sources (POLICY, SYSTEM, or AI).*

**Decision Trace Detail**
![Decision Drawer](docs/screenshots/02-decision-drawer.png)
*Deep-dive timeline into the precise stage where a payment was blocked or approved, providing full forensic context.*

**Simulation Lab**
![Simulation Lab](docs/screenshots/03-simulation-lab.png)
*Test payment scenarios safely using draft policies without persisting them into the live audit logs.*

**Control Plane**
![Control Plane](docs/screenshots/04-control-plane.png)
*Dynamic visualization and tuning of compound Hard and Soft logic JSON rules.*

**Compliance Audit**
![Compliance Audit](docs/screenshots/05-compliance-audit.png)
*Append-only cryptographic JSONL logs showing how the system maintained fail-closed integrity.*

---

## ✨ Key Features

1. **Deterministic Core Policies**: Instantly blocks known bad actors, velocity spikes, or specific merchants using a robust JSON rule engine before the AI is invoked.
2. **AI Reasoning Layer (OpenClaw)**: If deterministic limits are passed or flagged for "soft escalation", the context is handed off to a Gemini-powered engine for nuanced context evaluation.
3. **Fail-Closed Architecture (NemoClaw)**: If the LLM experiences an outage, timeout, or returns invalid data, the pipeline automatically fails-closed, dropping the request securely.
4. **Agentic Explainability**: Every decision leaves a strict chronological trace of its decision source (e.g., whether it was soft-flagged by Policy and overridden by AI, or blocked instantly by Policy).
5. **Simulation Lab**: A dedicated environment to preview model behaviors, replay old traces, and diff policy tuning outcomes.

## 🛠️ Tech Stack

- **Backend**: Node.js & Express
- **AI Engine**: Google Gemini (via `@google/genai` sdk) operating behind the generic `OpenClawAgent` interface.
- **Orchestration**: Custom `NemoClaw` wrapper to coordinate Policy + LLM logic states.
- **Data Persistence**: Local JSON store for policies, and an append-only JSONL log with hash chaining for the compliance audit trail.

---

## 🚀 Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/sentinelpay.git
   cd sentinelpay
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.0-flash # Or your preferred stable Google model
   PORT=3000
   ```

4. **Start the Sentinel Agent Worker**
   ```bash
   npm start
   ```

5. **Load the Dashboard**
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🏗️ Architecture Flow

1. **Request Received**: Basic payload shape validation.
2. **Policy Engine**: Checked against `data/policies.json`. Any critical violation (`HARD`) halts the pipeline (`BLOCK`).
3. **OpenClaw AI Evaluation**: Only processes the request if it survives the Policy phase. Evaluates nuanced business context mapping.
4. **NemoClaw Resolution**: Determines if the final state should be owned by `POLICY`, `AI`, `SYSTEM` (fail-close), or `COMBINED` (soft policy + AI).
5. **Audit Logger**: Outputs a cryptographic trace record to `audit_log.jsonl`.
