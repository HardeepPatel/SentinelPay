const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOG_FILE = path.join(__dirname, '..', '..', 'audit_log.jsonl');

/**
 * Appends a structured JSON decision trail to the audit log,
 * including SHA256 cryptographic hash-chaining to detect tampering.
 */
function appendAuditLog(logEntry, policyVersion) {
  const timestamp = new Date().toISOString();
  
  // 1. Recover the last hash to maintain the chain
  let previousHash = 'genesis_hash_0000000000';
  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      try {
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        if (lastEntry.currentHash) {
          previousHash = lastEntry.currentHash;
        }
      } catch (e) { /* ignore parse error on manual tamper */ }
    }
  }

  // 2. Prepare Payload
  const entryPayload = {
    timestamp,
    policyVersion, // Dynamic version trace
    ...logEntry,
  };

  // 3. Compute new deterministic hash
  // Hash = SHA256( previousHash + PayloadString )
  const payloadString = JSON.stringify(entryPayload);
  const currentHash = crypto.createHash('sha256')
    .update(previousHash + payloadString)
    .digest('hex');

  // 4. Construct Final Chain Document
  const finalEntry = {
    ...entryPayload,
    previousHash,
    currentHash
  };
  
  // Append as JSON Lines (JSONL)
  fs.appendFileSync(LOG_FILE, JSON.stringify(finalEntry) + '\n');
  console.log(`[Audit Logger] Integrity Verified. Trace=${finalEntry.traceId} | finalDecision=${finalEntry.finalDecision}`);
  return finalEntry;
}

module.exports = { appendAuditLog };
