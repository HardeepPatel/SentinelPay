const policyStore = require('../utils/policyStore');

/**
 * Parses and executes a dynamic condition against the request payload.
 */
function evaluateCondition(condition, request) {
  const reqVal = request[condition.field];
  const polVal = condition.value;

  switch (condition.operator) {
    case '>': return reqVal > polVal;
    case '<': return reqVal < polVal;
    case '==': return reqVal === polVal;
    case '!=': return reqVal !== polVal;
    case 'IN': return Array.isArray(polVal) && polVal.includes(reqVal);
    case 'NOT_IN': return Array.isArray(polVal) && !polVal.includes(reqVal);
    default: return false; // Fail safe
  }
}

/**
 * Runs all active dynamic policies. 
 * Supports Compound AND.
 * Outputs all tripped policies for conflict resolution upstream.
 */
function evaluatePolicies(request) {
  const policies = policyStore.getAll().filter(p => p.active);
  // Sort by priority (higher first) for the engine, although NemoClaw handles severity resolution
  policies.sort((a, b) => b.priority - a.priority);

  const triggered = [];

  for (const policy of policies) {
    let matchesAll = true;

    for (const cond of policy.conditions || []) {
      if (!evaluateCondition(cond, request)) {
        matchesAll = false;
        break; // Short-circuit AND
      }
    }

    if (matchesAll) {
      triggered.push({
        id: policy.id,
        name: policy.name,
        type: policy.type,
        action: policy.action,
        priority: policy.priority
      });
    }
  }

  return triggered;
}

/**
 * Same as evaluatePolicies but against an arbitrary policy array (for compare/simulation).
 */
function evaluatePoliciesWithOverride(request, policiesArray) {
  const policies = (policiesArray || []).filter(p => p.active);
  policies.sort((a, b) => b.priority - a.priority);

  const triggered = [];

  for (const policy of policies) {
    let matchesAll = true;

    for (const cond of policy.conditions || []) {
      if (!evaluateCondition(cond, request)) {
        matchesAll = false;
        break;
      }
    }

    if (matchesAll) {
      triggered.push({
        id: policy.id,
        name: policy.name,
        type: policy.type,
        action: policy.action,
        priority: policy.priority
      });
    }
  }

  return triggered;
}

module.exports = { evaluatePolicies, evaluatePoliciesWithOverride };
