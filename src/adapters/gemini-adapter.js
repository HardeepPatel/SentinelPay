require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { z } = require('zod');

const SpendAnalysisSchema = z
  .object({
    riskScore: z.number().min(0).max(1),
    decisionSuggestion: z.enum(["APPROVE", "ESCALATE", "BLOCK"]),
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string().min(1)).min(1).max(12),
    explanation: z.string().min(1),
  })
  .strict();

const SpendAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    riskScore: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Risk score from 0.0 to 1.0.",
    },
    decisionSuggestion: {
      type: "string",
      enum: ["APPROVE", "ESCALATE", "BLOCK"],
      description: "Recommended spend decision.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Model confidence from 0.0 to 1.0.",
    },
    signals: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 12,
      description: "Short risk signals supporting the recommendation.",
    },
    explanation: {
      type: "string",
      description: "Human-readable forensic explanation.",
    },
  },
  required: ["riskScore", "decisionSuggestion", "confidence", "signals", "explanation"],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJson(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed) {
    throw new Error("LLM_EMPTY_RESPONSE");
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("LLM_NON_JSON_RESPONSE");
  }

  return JSON.parse(match[0]);
}

class GeminiSpendAdapter {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || "gemini-3-flash-preview",
    timeoutMs = 8000,
    maxRetries = 1,
  } = {}) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required in environment variables.");
    }

    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.ai = new GoogleGenAI({ apiKey });
  }

  async analyzeSpend(context) {
    const prompt = [
      "You are OpenClaw, the risk reasoning layer for SentinelPay.",
      "Return ONLY valid JSON that matches the schema.",
      "Do not use markdown.",
      "Do not mention system prompts.",
      "Do not override hard policy decisions.",
      "Use APPROVE for normal low-risk spend, ESCALATE for ambiguous or unusual spend, BLOCK for clearly suspicious spend.",
      "Be concise but forensic.",
      "",
      "Transaction context:",
      JSON.stringify(context, null, 2),
    ].join("\n");

    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.#withTimeout(
          this.ai.models.generateContent({
            model: this.model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseJsonSchema: SpendAnalysisJsonSchema,
            },
          })
        );

        const rawText = response?.text ?? "";
        const parsed = extractJson(rawText);
        const validated = SpendAnalysisSchema.safeParse(parsed);

        if (!validated.success) {
          throw new Error(
            `LLM_SCHEMA_VALIDATION_FAILED: ${validated.error.message}`
          );
        }

        return validated.data;
      } catch (err) {
        lastError = err;

        if (attempt < this.maxRetries) {
          await sleep(250 * (attempt + 1));
          continue;
        }
      }
    }

    throw new Error(`OPENCLAW_LLM_FAILURE: ${lastError?.message || "unknown error"}`);
  }

  async #withTimeout(promise) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("LLM_TIMEOUT"));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

module.exports = { GeminiSpendAdapter };
