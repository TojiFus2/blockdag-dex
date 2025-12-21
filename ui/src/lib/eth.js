import { ethers } from "ethers";

export function hasInjected() {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

export async function requestAccounts() {
  if (!hasInjected()) throw new Error("No injected wallet found (MetaMask?)");
  await window.ethereum.request({ method: "eth_requestAccounts" });
}

export async function getBrowserProvider() {
  if (!hasInjected()) throw new Error("No injected wallet found (MetaMask?)");
  return new ethers.BrowserProvider(window.ethereum);
}

/**
 * Ensures the current chain is supported.
 * Pass the allowed chainIds and optionally a known chainId (already read).
 */
export async function ensureSupportedNetwork(allowedChainIds = [31337], knownChainId = null) {
  if (!hasInjected()) throw new Error("No injected wallet found (MetaMask?)");

  let cid = knownChainId;
  if (cid == null) {
    const provider = await getBrowserProvider();
    const net = await provider.getNetwork();
    cid = Number(net.chainId);
  }

  const ok = allowedChainIds.includes(cid);
  if (ok) return true;

  throw new Error(
    `Unsupported network (chainId=${cid}). Please switch to one of: ${allowedChainIds.join(", ")}.`
  );
}
