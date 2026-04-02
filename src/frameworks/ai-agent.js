/**
 * Generic AI Reasoning facade.
 * Now acts as a pass-through structure for the selected LLM Adapter (e.g., Gemini).
 */
class AiAgent {
  constructor(adapter) {
    if (!adapter) throw new Error("AiAgent requires a concrete LLM adapter instance.");
    this.adapter = adapter;
    this.name = 'SentinelSecurity_v1';
    this.role = 'Analyzes payment context to determine risk of fraud or anomalous spend behavior.';
  }

  /**
   * Evaluates the payment context using the underlying Model Adapter.
   * Expects structured output JSON.
   */
  async analyze(context) {
    // Adapter execution boundary.
    // The adapter enforces structured JSON and fallback timeouts.
    const result = await this.adapter.analyzeSpend(context);
    
    // Map the adapter's properties to the orchestrator's expected shape if necessary
    return {
      decision: result.decisionSuggestion,
      reasoning: "AI Agent: " + result.explanation,
      confidence: result.confidence,
      riskScore: result.riskScore,
      signals: result.signals
    };
  }
}

module.exports = { AiAgent };
