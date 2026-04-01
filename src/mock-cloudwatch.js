class MockCloudWatchStream {
  constructor() {
    this.listeners = [];
    this.isRunning = false;
    this.intervalId = null;
  }

  onLog(callback) {
    this.listeners.push(callback);
  }

  startSimulation() {
    this.isRunning = true;
    console.log('[CloudWatch Mock] Log stream started...');
    
    // Simulate typical logs
    this.intervalId = setInterval(() => {
      const isAnomaly = Math.random() > 0.8; // 20% chance of an anomaly
      let logEntry = {};

      if (isAnomaly) {
        const anomalyType = Math.random() > 0.5 ? 'LATENCY_SPIKE' : 'GATEWAY_TIMEOUT';
        
        if (anomalyType === 'LATENCY_SPIKE') {
          logEntry = {
            timestamp: new Date().toISOString(),
            service: 'payment-api',
            level: 'WARN',
            message: 'API Latency elevated',
            duration_ms: Math.floor(Math.random() * 5000) + 2000,
            gateway: 'stripe'
          };
        } else {
          logEntry = {
            timestamp: new Date().toISOString(),
            service: 'payment-gateway',
            level: 'ERROR',
            message: 'Connection timeout',
            duration_ms: 15000,
            gateway: 'redis-cache'
          };
        }
      } else {
        logEntry = {
          timestamp: new Date().toISOString(),
          service: 'payment-api',
          level: 'INFO',
          message: 'Payment processed successfully',
          duration_ms: Math.floor(Math.random() * 200) + 50,
          gateway: 'stripe'
        };
      }

      this.listeners.forEach(listener => listener(logEntry));
    }, 2000); // Emits every 2 seconds
  }

  stopSimulation() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    console.log('[CloudWatch Mock] Log stream stopped.');
  }
}

module.exports = { MockCloudWatchStream };
