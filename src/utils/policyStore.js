const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'policies.json');

/**
 * Interface to abstracted policy storage and versioning.
 */
class PolicyStore {
  constructor() {
    this.ensureFile();
  }

  ensureFile() {
    if (!fs.existsSync(DATA_FILE)) {
      // Create empty array if missing
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
    }
  }

  getAll() {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    try {
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  save(policiesArray) {
    const data = JSON.stringify(policiesArray, null, 2);
    fs.writeFileSync(DATA_FILE, data, 'utf8');
  }

  /**
   * Generates a structural-based version tag for the active policies.
   */
  getVersion() {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    // Using first 8 chars of sha256 as our strict version identifier
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return `v_${hash.substring(0, 8)}`;
  }
}

module.exports = new PolicyStore();
