const { MockCloudWatchStream } = require('./mock-cloudwatch');
const { OpenClawAgent } = require('./frameworks/openclaw');
const { NemoClawContainer } = require('./frameworks/nemoclaw');
require('dotenv').config();

// SentinelPay: Observability Phase Entry

async function bootstrap() {
  console.log('>>> Bootstrapping SentinelPay Observability Agent (Phase 1) <<<');

  // 1. Initialize the core OpenClaw Agent
  const baseAgent = new OpenClawAgent({
    name: 'SentinelObservability_v1',
    role: 'Monitors payment infrastructure logs and detects anomalies before cascading failures occur.',
    tools: [
      { name: 'REROUTE_TRAFFIC', description: 'Shifts traffic away from failing gateway.' },
      { name: 'ALERT_TEAM', description: 'Notifies human on-call with RCA context.' }
    ]
  });

  // 2. Wrap using NemoClaw for enterprise security and guardrails
  const secureContainer = new NemoClawContainer({
    name: 'OpsSandbox',
    agent: baseAgent,
    policies: [
      'Disallow rerouting > 50% traffic without human approval',
      'Never expose PII in log extraction'
    ]
  });

  // Initialize sandbox models and weights
  await secureContainer.initialize();

  // 3. Connect to the mock data stream
  const logStream = new MockCloudWatchStream();
  
  logStream.onLog(async (logEntry) => {
    console.log(`\n[Log Event Received] ${logEntry.timestamp} | ${logEntry.service} | ${logEntry.level}`);
    
    try {
      // 4. Dispatch the event into the NemoClaw secured Agent
      const analysis = await secureContainer.dispatch(logEntry);
      
      console.log(`[Agent Decision]: ${analysis.decision}`);
      if (analysis.decision === 'ACTION_REQUIRED') {
        console.log(`=> Recommended Action: ${analysis.recommendedAction}`);
        console.log(`=> Reasoning Snapshot: ${analysis.reasoning}`);
      }
    } catch (error) {
      console.error('Agent analysis failed:', error.message);
    }
  });

  // Start the actual ingestion flow
  logStream.startSimulation();
}

bootstrap().catch(console.error);
