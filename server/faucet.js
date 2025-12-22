const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const CLAIMS_PATH = path.join(__dirname, "claims_1043.json");
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_AMOUNT = 100;

const USDC_ADDRESS = "0xd7eFc4e37306b379C88DBf8749189C480bfEA340";
const USDC_DECIMALS = 6;

const USDC_ABI = [
  "function mint(address to, uint256 amount) external",
  "function owner() view returns (address)",
];

function clampAmount(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.max(1, Math.min(MAX_AMOUNT, Math.floor(n)));
}

function readClaims() {
  try {
    if (!fs.existsSync(CLAIMS_PATH)) return {};
    return JSON.parse(fs.readFileSync(CLAIMS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeClaims(claims) {
  const tmp = `${CLAIMS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(claims, null, 2), "utf8");
  fs.renameSync(tmp, CLAIMS_PATH);
}

function shortErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

async function drip({ wallet, amount }) {
  if (!ethers.isAddress(wallet || "")) throw new Error("Invalid wallet address");

  const amt = clampAmount(amount);

  const claims = readClaims();
  const key = wallet.toLowerCase();
  const now = Date.now();
  const last = Number(claims?.[key]?.lastClaimMs || 0);

  if (last && now - last < COOLDOWN_MS) {
    const mins = Math.ceil((COOLDOWN_MS - (now - last)) / 60000);
    throw new Error(`Cooldown active. Retry in ~${mins} min`);
  }

  const rpcUrl = process.env.BDAG_RPC_URL || process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL missing");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);

  const token = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);

  // Sanity: faucet MUST be owner
  const owner = await token.owner();
  const signerAddr = await signer.getAddress();
  if (owner.toLowerCase() !== signerAddr.toLowerCase()) {
    throw new Error(`Faucet is not token owner. Owner=${owner}`);
  }

  const amountRaw = ethers.parseUnits(String(amt), USDC_DECIMALS);

  const tx = await token.mint(wallet, amountRaw, { gasLimit: 500_000n });
  const rc = await tx.wait();
  if (rc.status !== 1) throw new Error("Mint transaction reverted");

  claims[key] = { lastClaimMs: now, lastAmount: amt, txHash: tx.hash };
  writeClaims(claims);

  return tx.hash;
}

module.exports = { drip };
