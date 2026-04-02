require('dotenv').config();
const { GeminiSpendAdapter } = require('../src/adapters/gemini-adapter');
const { DecisionEngine } = require('../src/frameworks/decision-engine');
const { SentinelPayAgent } = require('../src/frameworks/ai-agent');
const path = require('path');

const scenarios = [
  {
    name: "Normal coffee spend",
    request: {
      decisionId: "eval-coffee",
      traceId: "eval-trace-coffee",
      userId: "u123",
      merchantId: "coffee_shop",
      amount: 5,
      currency: "USD",
      department: "engineering",
      category: "food",
      paymentMethod: "card",
      justification: "Morning coffee",
    },
    expectedFinalDecision: "APPROVE",
    expectedPolicyShortCircuit: false,
  },
  {
    name: "High value unusual spend",
    request: {
      decisionId: "eval-high-value",
      traceId: "eval-trace-high-value",
      userId: "u444",
      merchantId: "electronics",
      amount: 4500,
      currency: "USD",
      department: "engineering",
      category: "electronics",
      paymentMethod: "card",
      justification: "Urgent purchase",
    },
    expectedFinalDecision: "ESCALATE",
    expectedPolicyShortCircuit: false,
  },
  {
    name: "Blacklisted merchant",
    request: {
      decisionId: "eval-blacklist",
      traceId: "eval-trace-blacklist",
      userId: "u999",
      merchantId: "merch_block_001",
      amount: 10,
      currency: "USD",
      department: "finance",
      category: "misc",
      paymentMethod: "card",
      justification: "Test payment",
    },
    expectedFinalDecision: "BLOCK",
    expectedPolicyShortCircuit: true,
  },
  {
    name: "New vendor logic",
    request: {
      decisionId: "eval-new-vendor",
      traceId: "eval-trace-new-vendor",
      userId: "u777",
      merchantId: "new_saas_vendor_xyz",
      amount: 120,
      currency: "USD",
      department: "product",
      category: "saas",
      paymentMethod: "card",
      justification: "Trial subscription",
    },
    expectedFinalDecision: "ESCALATE",
    expectedPolicyShortCircuit: false,
  },
  {
    name: "Repeated small fraud pattern",
    request: {
      decisionId: "eval-smurfing",
      traceId: "eval-trace-smurfing",
      userId: "u888",
      merchantId: "gift_cards",
      amount: 49,
      currency: "USD",
      department: "engineering",
      category: "gift_cards",
      paymentMethod: "card",
      justification: "Small purchase",
      recentBurstCount: 8,
      recentBurstWindowMinutes: 15,
    },
    expectedFinalDecision: "BLOCK",
    expectedPolicyShortCircuit: false, // AI flags as BLOCK in our hypothetical
  },
];

function normalizeDecision(result) {
  return String(result?.finalDecision || result?.decision || "").toUpperCase();
}

function explanationText(result) {
  return [
    result?.aiReasoning,
    result?.explanation,
    result?.policyBlockReason,
    result?.reason,
  ]
    .filter(Boolean)
    .join(" | ");
}

function explanationQualityScore(result) {
  const text = explanationText(result);

  if (!text) return 0;

  const signals = [
    /amount/i.test(text),
    /merchant/i.test(text),
    /risk/i.test(text),
    /policy/i.test(text),
    /pattern/i.test(text),
    /history/i.test(text),
  ];

  const positive = signals.filter(Boolean).length;
  const lengthScore = Math.min(text.length / 120, 1);
  const structureScore = /approve|block|escalate/i.test(text) ? 1 : 0;

  return Math.round(((positive / signals.length) * 0.45 + lengthScore * 0.35 + structureScore * 0.2) * 100);
}

async function main() {
  const adapter = new GeminiSpendAdapter({
    timeoutMs: 8000,
    maxRetries: 1,
  });

  const baseAgent = new SentinelPayAgent(adapter);
  
  const nemo = new DecisionEngine({
    name: 'EvalHarness',
    agent: baseAgent
  });

  await nemo.initialize();

  const results = [];
  let correctDecisionCount = 0;
  let falseApproveCount = 0;
  let falseEscalateCount = 0;
  let policyShortCircuitCount = 0;

  console.log("\n=== SentinelPay Eval Harness ===\n");

  for (const scenario of scenarios) {
    const startedAt = Date.now();

    try {
      const result = await nemo.dispatch(scenario.request);
      const decision = normalizeDecision(result);
      const explanationScore = explanationQualityScore(result);
      const elapsedMs = Date.now() - startedAt;

      const isCorrect = decision === scenario.expectedFinalDecision;
      if (isCorrect) correctDecisionCount += 1;

      if (decision === "APPROVE" && scenario.expectedFinalDecision !== "APPROVE") {
        falseApproveCount += 1;
      }

      // If it escalated when we wanted an explicit BLOCK
      if (decision === "ESCALATE" && scenario.expectedFinalDecision === "BLOCK") {
        falseEscalateCount += 1;
      }

      if (result?.passedHardRules === false || result?.policyBlockReason) {
        policyShortCircuitCount += 1;
      }

      results.push({
        name: scenario.name,
        expected: scenario.expectedFinalDecision,
        actual: decision,
        pass: isCorrect,
        elapsedMs,
        explanationQuality: explanationScore,
      });

      console.log(
        JSON.stringify(
          {
            name: scenario.name,
            expected: scenario.expectedFinalDecision,
            actual: decision,
            pass: isCorrect,
            elapsedMs,
            explanationQuality: explanationScore,
            finalDecision: result?.finalDecision,
            policyBlockReason: result?.policyBlockReason || null,
            aiReasoning: result?.aiReasoning || result?.explanation || null,
          },
          null,
          2
        )
      );
    } catch (err) {
      results.push({
        name: scenario.name,
        expected: scenario.expectedFinalDecision,
        actual: "ERROR",
        pass: false,
        error: err.message,
      });

      console.log(
        JSON.stringify(
          {
            name: scenario.name,
            expected: scenario.expectedFinalDecision,
            actual: "ERROR",
            pass: false,
            error: err.message,
          },
          null,
          2
        )
      );
    }

    console.log("\n---\n");
  }

  const total = scenarios.length;
  const passed = results.filter((r) => r.pass).length;
  const avgExplanationQuality =
    Math.round(
      results
        .filter((r) => typeof r.explanationQuality === "number")
        .reduce((sum, r) => sum + r.explanationQuality, 0) /
        Math.max(1, results.filter((r) => typeof r.explanationQuality === "number").length)
    ) || 0;

  const summary = {
    total,
    passed,
    accuracy: `${Math.round((passed / total) * 100)}%`,
    falseApproveRate: `${Math.round((falseApproveCount / total) * 100)}%`,
    falseEscalateRate: `${Math.round((falseEscalateCount / total) * 100)}%`,
    policyShortCircuitCount,
    avgExplanationQuality,
  };

  console.log("=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  if (passed !== total) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Eval harness failed:", err);
  process.exitCode = 1;
});
