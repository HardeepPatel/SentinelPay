async function runTests() {
  const tests = [
    { name: 'Coffee', data: { amount: 5, userId: 'u123', merchantId: 'coffee_shop' } },
    { name: 'High Value', data: { amount: 4500, userId: 'u444', merchantId: 'electronics' } },
    { name: 'Blocked Merchant', data: { amount: 10, userId: 'u999', merchantId: 'merch_block_001' } },
    { name: 'Fail Closed', data: { amount: 10, userId: 'u000', merchantId: 'store', forceAiError: true } },
  ];

  for (const test of tests) {
    try {
      console.log(`\n=> Running Test: ${test.name}`);
      const res = await fetch('http://localhost:3000/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test.data)
      });
      const json = await res.json();
      console.log(`Status: ${res.status}`);
      console.log(`Response: ${JSON.stringify(json, null, 2)}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }
}

runTests();
