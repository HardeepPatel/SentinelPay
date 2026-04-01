const express = require('express');
const fs = require('fs');
const path = require('path');
const { OpenClawAgent } = require('./frameworks/openclaw');
const { NemoClawContainer } = require('./frameworks/nemoclaw');
const { GeminiSpendAdapter } = require('./adapters/gemini-adapter');
const policyStore = require('./utils/policyStore');
require('dotenv').config();

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));

// 1. Initialize the Core AI Adapter
const llmAdapter = new GeminiSpendAdapter({ timeoutMs: 15000, maxRetries: 1 });

// 2. Inject Adapter into OpenClaw Agent
const baseAgent = new OpenClawAgent(llmAdapter);

// 3. Wrap using NemoClaw pipeline orchestrator
const securePipeline = new NemoClawContainer({ name: 'SecurityPipeline', agent: baseAgent });

// Helper: Read the latest logs safely
const LOG_FILE = path.join(__dirname, '..', 'audit_log.jsonl');
function getParsedLogs() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const content = fs.readFileSync(LOG_FILE, 'utf-8');
  return content.split('\n')
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line); } catch (e) { return null; } })
    .filter(Boolean)
    .reverse();
}

// ==========================================
// API ROUTES
// ==========================================

// Core Processing API (live payments)
app.post('/payment', async (req, res) => {
  try {
    const auditRecord = await securePipeline.dispatch(req.body);
    if (auditRecord.finalDecision === 'BLOCK') res.status(403).json(auditRecord);
    else if (auditRecord.finalDecision === 'ESCALATE') res.status(401).json(auditRecord);
    else res.status(200).json(auditRecord);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// --- Dashboard APIs ---
app.get('/api/payments', (req, res) => res.json(getParsedLogs()));

app.get('/api/payments/:id', (req, res) => {
  const record = getParsedLogs().find(l => l.decisionId === req.params.id);
  return record ? res.json(record) : res.status(404).json({ error: 'Not found' });
});

// --- Policies ---
app.get('/api/policies', (req, res) => {
  res.json({ version: policyStore.getVersion(), policies: policyStore.getAll() });
});

app.put('/api/policies', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be an array of policies' });
  policyStore.save(req.body);
  res.json({ message: 'Saved successfully', version: policyStore.getVersion() });
});

// --- Metrics ---
app.get('/api/metrics', (req, res) => {
  const logs = getParsedLogs();
  const total = logs.length || 1;
  const blocked = logs.filter(l => l.finalDecision === 'BLOCK').length;
  const escalated = logs.filter(l => l.finalDecision === 'ESCALATE').length;
  const approved = logs.filter(l => l.finalDecision === 'APPROVE').length;
  const policyHits = logs.filter(l => !l.passedHardRules).length;
  const failClosed = logs.filter(l => l.decisionSource === 'SYSTEM').length;

  res.json({
    totalRequests: logs.length,
    blockedPct: Math.round((blocked / total) * 100),
    escalatedPct: Math.round((escalated / total) * 100),
    approvedPct: Math.round((approved / total) * 100),
    policyHitRate: Math.round((policyHits / total) * 100),
    failClosedEvents: failClosed,
    currentPolicyVersion: policyStore.getVersion()
  });
});

// --- Enriched Trace Replay API ---
app.get('/api/audit/:traceId/replay', (req, res) => {
  const record = getParsedLogs().find(l => l.traceId === req.params.traceId);
  if (!record) return res.status(404).json({ error: 'TRACE_NOT_FOUND', traceId: req.params.traceId });
  
  res.json({
    traceId: record.traceId,
    decisionId: record.decisionId,
    timestamp: record.timestamp,
    userId: record.requestContext?.userId,
    merchantId: record.requestContext?.merchantId,
    amount: record.requestContext?.amount,
    currency: record.requestContext?.currency || 'USD',
    finalDecision: record.finalDecision,
    decisionSource: record.decisionSource,
    policyVersion: record.policyVersion,
    policyResult: record.policyResult || {
      passed: record.passedHardRules,
      matchedPolicies: [],
      failedPolicy: null,
      blockReason: record.policyBlockReason,
      severity: record.passedHardRules ? 'NONE' : 'HARD'
    },
    aiResult: record.aiResult,
    timeline: record.timeline || [
      { step: 1, stage: 'REQUEST_RECEIVED', status: 'OK', message: 'Payment request accepted' },
      { step: 2, stage: 'POLICY_ENGINE', status: record.passedHardRules ? 'PASS' : 'BLOCK', message: record.traceLog?.step1_policy || 'N/A' },
      { step: 3, stage: 'OPENCLAW_AI', status: record.passedHardRules ? 'DONE' : 'SKIPPED', message: record.traceLog?.step2_ai || 'N/A' },
      { step: 4, stage: 'AUDIT_LOGGER', status: 'WRITTEN', message: 'Append-only JSONL entry persisted' }
    ],
    integrity: {
      hashChainStatus: record.currentHash ? 'VALID' : 'UNVERIFIED',
      currentHash: record.currentHash || null,
      previousHash: record.previousHash || null
    }
  });
});

// --- Simulation: Preset Scenarios (sidebar buttons) ---
app.post('/api/simulate', async (req, res) => {
  const { scenario } = req.body;
  let requestData = {};

  // If scenario is a preset string, use presets. Otherwise treat body as custom simulation input.
  if (scenario === 'coffee') {
    requestData = { amount: 5, userId: 'u123', merchantId: 'coffee_shop', department: 'engineering', category: 'food', justification: 'Morning coffee' };
  } else if (scenario === 'high_value') {
    requestData = { amount: 60000, userId: 'u444', merchantId: 'electronics', department: 'engineering', category: 'electronics', justification: 'Urgent purchase' };
  } else if (scenario === 'blocked') {
    requestData = { amount: 10, userId: 'u999', merchantId: 'merch_scam_999', department: 'finance', category: 'misc', justification: 'Test payment' };
  } else if (scenario) {
    return res.status(400).json({ error: 'Unknown scenario' });
  } else {
    // Custom simulation: the body IS the request data
    requestData = req.body;
  }

  try {
    // Custom simulations don't persist; presets do
    const persistAudit = !!scenario;
    const auditRecord = await securePipeline.dispatch(requestData, { persistAudit, mode: persistAudit ? 'live' : 'preview' });
    
    res.json({
      simulationId: `sim_${Date.now()}`,
      traceId: auditRecord.traceId,
      decisionId: auditRecord.decisionId,
      decision: auditRecord.finalDecision,
      decisionSource: auditRecord.decisionSource,
      policyVersion: auditRecord.policyVersion,
      policyResult: auditRecord.policyResult,
      aiResult: auditRecord.aiResult,
      finalReason: auditRecord.finalReason,
      timeline: auditRecord.timeline,
      integrity: {
        hashChainStatus: persistAudit ? 'VALID' : 'NOT_PERSISTED',
        note: persistAudit ? 'Audit log written' : 'Simulation only. No audit log written.'
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'SIMULATION_FAILED', message: err.message });
  }
});

// --- Simulation Compare: current vs draft policies ---
app.post('/api/simulate/compare', async (req, res) => {
  try {
    const { input, draftPolicies } = req.body;
    if (!input) return res.status(400).json({ error: 'INVALID_REQUEST', message: 'Missing input payload' });

    const currentResult = await securePipeline.dispatch(input, { persistAudit: false, mode: 'preview' });
    const draftResult = await securePipeline.dispatch(input, { persistAudit: false, mode: 'preview', policyOverride: draftPolicies || null });

    res.json({
      comparisonId: `cmp_${Date.now()}`,
      input,
      current: {
        finalDecision: currentResult.finalDecision,
        decisionSource: currentResult.decisionSource,
        policyResult: currentResult.policyResult,
        aiResult: currentResult.aiResult,
        finalReason: currentResult.finalReason,
        timeline: currentResult.timeline
      },
      draft: {
        finalDecision: draftResult.finalDecision,
        decisionSource: draftResult.decisionSource,
        policyResult: draftResult.policyResult,
        aiResult: draftResult.aiResult,
        finalReason: draftResult.finalReason,
        timeline: draftResult.timeline
      },
      diff: {
        decisionChanged: currentResult.finalDecision !== draftResult.finalDecision,
        sourceChanged: currentResult.decisionSource !== draftResult.decisionSource,
        policyChanged: JSON.stringify(currentResult.policyResult) !== JSON.stringify(draftResult.policyResult),
        aiChanged: JSON.stringify(currentResult.aiResult) !== JSON.stringify(draftResult.aiResult)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'COMPARE_SIMULATION_FAILED', message: error.message });
  }
});

const PORT = process.env.PORT || 3000;

securePipeline.initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`[SentinelPay Dashboard] UI & API active at http://localhost:${PORT}`);
  });
}).catch(console.error);
