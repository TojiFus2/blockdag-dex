export async function loadDeployments(chainId) {
  const url = `/deployments/${chainId}.json?ts=${Date.now()}`; // bust cache hard
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    throw new Error(`Deployments not found at /deployments/${chainId}.json. Did you run deploy + copy?`);
  }
  return await r.json();
}
