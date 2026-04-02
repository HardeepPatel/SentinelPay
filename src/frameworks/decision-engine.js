const { randomUUID } = require('crypto');
const { evaluatePolicies } = require('../middleware/policy-engine');
const { appendAuditLog } = require('../middleware/audit-logger');
const policyStore = require('../utils/policyStore');

/**
 * DecisionEngine Orchestrator.
 * Flow: Priority Policy Checks -> Conflict Resolution -> Agent -> Audit with Version
 * 
 * decisionSource values:
 *   POLICY   — Hard policy short-circuited. AI never called.
 *   AI       — Policy passed. AI made the final call.
 *   SYSTEM   — AI errored/timed out. Fail-closed to BLOCK.
 *   COMBINED — Soft policy set the floor, AI provided reasoning context.
 */
class DecisionEngine {
  constructor(config) {
    this.name = config.name;
    this.agent = config.agent; 
    this.isReady = false;
  }

  async initialize() {
    console.log(`[DecisionEngine Sandbox: ${this.name}] Initializing secure OpenShell environment...`);
    this.isReady = true;
    console.log(`[DecisionEngine Sandbox: ${this.name}] Pipeline active.`);
  }

  /**
   * Core orchestration. Used by both live dispatch and simulation.
   * @param {object} requestData - The payment request context.
   * @param {object} options - { persistAudit: true, mode: 'live'|'preview', policyOverride: null|Array }
   */
  async dispatch(requestData, options = {}) {
    const { persistAudit = true, mode = 'live', policyOverride = null } = options;
    if (!this.isReady) throw new Error('DecisionEngine container not initialized');
    
    const decisionId = `dec_${randomUUID().split('-')[0]}`;
    const traceId = `trace_${randomUUID().split('-')[0]}`;
    const policyVersion = policyStore.getVersion();
    
    let finalDecision = 'BLOCK';
    let finalReason = 'Internal Server Error';
    let decisionSource = 'SYSTEM';
    let passedHardRules = false;

    let policyResult = { passed: false, matchedPolicies: [], failedPolicy: null, blockReason: null, severity: 'NONE' };
    let aiResult = null;

    // Timeline for the structured replay API
    const timeline = [
      { step: 1, stage: 'REQUEST_RECEIVED', status: 'OK', message: `Payment request accepted by SentinelPay (${mode})` }
    ];

    try {
      console.log(`[DecisionEngine Pipeline] Running Policy Check under Engine Version: ${policyVersion}...`);
      
      // If policyOverride is provided (compare mode), evaluate against those instead
      let trippedPolicies;
      if (policyOverride) {
        // Temporarily use override policies
        const policyEngine = require('../middleware/policy-engine');
        trippedPolicies = policyEngine.evaluatePoliciesWithOverride(requestData, policyOverride);
      } else {
        trippedPolicies = evaluatePolicies(requestData);
      }
      
      const isHardFail = trippedPolicies.find(p => p.type === 'HARD' && p.action === 'BLOCK');
      
      if (isHardFail) {
        passedHardRules = false;
        finalDecision = 'BLOCK';
        decisionSource = 'POLICY';
        finalReason = isHardFail.name;
        
        policyResult = {
          passed: false,
          matchedPolicies: trippedPolicies.map(p => p.name),
          failedPolicy: isHardFail.name,
          blockReason: `Policy Violation [Priority ${isHardFail.priority}]: ${isHardFail.name}`,
          severity: 'HARD'
        };

        timeline.push({ step: 2, stage: 'POLICY_ENGINE', status: 'BLOCK', message: policyResult.blockReason });
        timeline.push({ step: 3, stage: 'AI_AGENT', status: 'SKIPPED', message: 'AI not called because hard policy blocked the request' });
        timeline.push({ step: 4, stage: 'AUDIT_LOGGER', status: persistAudit ? 'WRITTEN' : 'SKIPPED', message: persistAudit ? 'Append-only JSONL entry persisted and hash chained' : 'Simulation mode — no audit persisted' });

      } else {
        passedHardRules = true;
        policyResult.passed = true;

        const softEscalations = trippedPolicies.filter(p => p.type === 'SOFT' && p.action === 'ESCALATE');
        policyResult.matchedPolicies = softEscalations.map(p => p.name);
        policyResult.severity = softEscalations.length > 0 ? 'SOFT' : 'NONE';

        if (softEscalations.length > 0) {
          timeline.push({ step: 2, stage: 'POLICY_ENGINE', status: 'PASS', message: `Soft escalation: ${softEscalations.map(p => p.name).join(', ')}` });
          console.log(`[DecisionEngine Pipeline] Escalate requested by SOFT policies. Deferring to AI for context...`);
        } else {
          timeline.push({ step: 2, stage: 'POLICY_ENGINE', status: 'PASS', message: 'No hard policy violation found' });
          console.log(`[DecisionEngine Pipeline] Hard limits passed. Delegating to AI Agent...`);
        }
        
        const rawAi = await this.agent.analyze(requestData);
        
        aiResult = {
          riskScore: rawAi.riskScore ?? null,
          decisionSuggestion: rawAi.decision,
          confidence: rawAi.confidence ?? null,
          signals: rawAi.signals ?? [],
          explanation: rawAi.reasoning
        };

        timeline.push({ step: 3, stage: 'AI_AGENT', status: 'DONE', message: `AI suggested ${rawAi.decision} (risk: ${rawAi.riskScore ?? 'N/A'}, conf: ${rawAi.confidence ?? 'N/A'})` });

        if (softEscalations.length > 0) {
          finalDecision = 'ESCALATE';
          decisionSource = 'COMBINED';
          finalReason = `${softEscalations[0].name} — ${rawAi.reasoning}`;
        } else {
          finalDecision = rawAi.decision;
          decisionSource = 'AI';
          finalReason = rawAi.reasoning;
        }

        timeline.push({ step: 4, stage: 'DECISION_ENGINE_ORCHESTRATOR', status: finalDecision, message: `Final decision: ${finalDecision} (owner: ${decisionSource})` });
        timeline.push({ step: 5, stage: 'AUDIT_LOGGER', status: persistAudit ? 'WRITTEN' : 'SKIPPED', message: persistAudit ? 'Append-only JSONL entry persisted and hash chained' : 'Simulation mode — no audit persisted' });
      }
    } catch (e) {
      console.error(`[DecisionEngine Security] Caught critical error: ${e.message}. Fencing request.`);
      finalDecision = 'BLOCK';
      decisionSource = 'SYSTEM';
      finalReason = `LLM failure → fail-closed: ${e.message}`;

      aiResult = {
        riskScore: null,
        decisionSuggestion: null,
        confidence: null,
        signals: [],
        explanation: `LLM failure: ${e.message}. DecisionEngine fail-closed triggered.`
      };

      if (!timeline.some(t => t.stage === 'POLICY_ENGINE')) {
        timeline.push({ step: 2, stage: 'POLICY_ENGINE', status: passedHardRules ? 'PASS' : 'UNKNOWN', message: passedHardRules ? 'No hard violation found' : 'Policy state unknown' });
      }
      timeline.push({ step: 3, stage: 'AI_AGENT', status: 'TIMEOUT', message: e.message });
      timeline.push({ step: 4, stage: 'DECISION_ENGINE_ORCHESTRATOR', status: 'BLOCK', message: 'Fail-closed enforced' });
      timeline.push({ step: 5, stage: 'AUDIT_LOGGER', status: persistAudit ? 'WRITTEN' : 'SKIPPED', message: persistAudit ? 'Append-only JSONL entry persisted and hash chained' : 'Simulation mode — no audit persisted' });
    }

    const auditRecord = {
      decisionId,
      traceId,
      requestContext: requestData,
      passedHardRules,
      finalDecision,
      decisionSource,
      finalReason,
      policyVersion,
      policyResult,
      aiResult,
      timeline,
      // Legacy compat
      aiReasoning: aiResult ? aiResult.explanation : null,
      policyBlockReason: !passedHardRules ? policyResult.blockReason : null,
      traceLog: {
        step1_policy: timeline.find(t => t.stage === 'POLICY_ENGINE')?.message || 'N/A',
        step2_ai: timeline.find(t => t.stage === 'AI_AGENT')?.message || 'N/A',
        step3_decision: finalDecision,
        step4_owner: decisionSource
      }
    };

    if (persistAudit) {
      appendAuditLog(auditRecord, policyVersion);
    }

    return auditRecord;
  }
}

module.exports = { DecisionEngine };
