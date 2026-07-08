const apiUrl = process.env.API_URL ?? 'http://localhost:3333';

async function get(path) {
  const response = await fetch(`${apiUrl}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }
  return response.json();
}

await get('/health');
await get('/ready');
await get('/offers/stats');
await get('/offers?limit=5');

console.log('Public API smoke test passed');
