const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const CLAIMS_PATH = path.join(__dirname, "claims_1043.json");
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_AMOUNT = 100;

const MOCK_USDCV2_ADDRESS = "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2";
const MOCK_USDCV2_DECIMALS = 6;

const MOCK_USDCV2_ABI = [
  "function mint(address to, uint256 amount) external",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
];

function clampAmount(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error("Invalid amount");
  return Math.max(1, Math.min(MAX_AMOUNT, Math.floor(n)));
}

function readClaims() {
  try {
    if (!fs.existsSync(CLAIMS_PATH)) return {};
    const raw = fs.readFileSync(CLAIMS_PATH, "utf8");
    const json = JSON.parse(raw || "{}");
    if (!json || typeof json !== "object") return {};
    return json;
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
  if (!ethers.isAddress(wallet || "")) throw new Error("Invalid wallet");
  const amt = clampAmount(amount);

  const claims = readClaims();
  const key = wallet.toLowerCase();
  const now = Date.now();
  const last = Number(claims?.[key]?.lastClaimMs || 0);

  if (last && now - last < COOLDOWN_MS) {
    const remainingMs = COOLDOWN_MS - (now - last);
    const remainingMin = Math.ceil(remainingMs / 60000);
    throw new Error(`Cooldown active. Try again in ~${remainingMin} min`);
  }

  const rpcUrl = process.env.BDAG_RPC_URL || process.env.RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL missing");

  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(pk, provider);

  const tokenAddr = process.env.MOCK_USDCV2_ADDRESS || MOCK_USDCV2_ADDRESS;
  const token = new ethers.Contract(tokenAddr, MOCK_USDCV2_ABI, signer);

  const amountRaw = ethers.parseUnits(String(amt), MOCK_USDCV2_DECIMALS);

  let tx;
  try {
    tx = await token.mint(wallet, amountRaw, { gasLimit: 600_000n });
  } catch (e) {
    try {
      const faucetAddr = await signer.getAddress();
      const bal = await token.balanceOf(faucetAddr);
      if (bal < amountRaw) throw new Error("Faucet balance too low (transfer fallback)");
      tx = await token.transfer(wallet, amountRaw, { gasLimit: 300_000n });
    } catch (e2) {
      throw new Error(`Mint failed; transfer failed: ${shortErr(e2)}`);
    }
  }

  claims[key] = { lastClaimMs: now, lastAmount: amt, txHash: tx.hash };
  writeClaims(claims);

  return tx.hash;
}

module.exports = { drip };

