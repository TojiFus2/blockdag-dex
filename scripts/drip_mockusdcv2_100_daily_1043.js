// scripts/drip_mockusdcv2_100_daily_1043.js
// ENV:
//   FAUCET_WALLET=0x...
//   FAUCET_AMOUNT=100
//
// Rules:
// - max 100 USDC
// - 1 claim / 24h per wallet
// - storage locale JSON

const fs = require("fs");
const path = require("path");

const CLAIMS_FILE = path.join(__dirname, "faucet_claims_1043.json");
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const MAX_AMOUNT = 100;
const DEFAULT_AMOUNT = 100;

const MOCK_USDCV2 = "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
];

function readClaims() {
  try {
    return JSON.parse(fs.readFileSync(CLAIMS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeClaims(obj) {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(obj, null, 2));
}

async function main() {
  const { ethers, network } = require("hardhat");

  const wallet = process.env.FAUCET_WALLET;
  const amountEnv = process.env.FAUCET_AMOUNT;

  if (!wallet || !ethers.isAddress(wallet)) {
    throw new Error("Missing or invalid FAUCET_WALLET env var");
  }

  let amountHuman = DEFAULT_AMOUNT;
  if (amountEnv) {
    const n = Number(amountEnv);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("Invalid FAUCET_AMOUNT");
    }
    amountHuman = Math.min(n, MAX_AMOUNT);
  }

  const claims = readClaims();
  const key = wallet.toLowerCase();
  const last = claims[key]?.lastClaimMs || 0;

  if (last && Date.now() - last < COOLDOWN_MS) {
    const mins = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 60000);
    throw new Error(`Cooldown active. Retry in ~${mins} minutes`);
  }

  const [deployer] = await ethers.getSigners();
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("Recipient:", wallet);
  console.log("Amount:", amountHuman, "USDC");

  const token = await ethers.getContractAt(ERC20_ABI, MOCK_USDCV2, deployer);
  const dec = Number(await token.decimals());
  const amount = ethers.parseUnits(String(amountHuman), dec);

  let tx;
  try {
    tx = await token.mint(wallet, amount);
    await tx.wait();
    console.log("mint OK:", tx.hash);
  } catch {
    const bal = await token.balanceOf(deployer.address);
    if (bal < amount) throw new Error("Deployer has insufficient USDC");

    tx = await token.transfer(wallet, amount);
    await tx.wait();
    console.log("transfer OK:", tx.hash);
  }

  claims[key] = {
    lastClaimMs: Date.now(),
    amount: amountHuman,
    tx: tx.hash,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
  };

  writeClaims(claims);
  console.log("DONE");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
