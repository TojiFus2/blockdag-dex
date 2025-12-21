// scripts/scan_pairs.js
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function isAddressLike(x) {
  return typeof x === "string" && /^0x[a-fA-F0-9]{40}$/.test(x);
}

function pickFactoryAddress(deployments) {
  // 1) tentativi "canonici"
  const candidates = [
    deployments.factory,
    deployments.uniswapV2Factory,
    deployments.factoryAddress,
    deployments.Factory,
    deployments.UNISWAP_V2_FACTORY,
  ].filter(isAddressLike);

  if (candidates.length > 0) return candidates[0];

  // 2) fallback: prima chiave che contiene "factory" e valore address
  for (const [k, v] of Object.entries(deployments)) {
    if (k.toLowerCase().includes("factory") && isAddressLike(v)) return v;
  }

  // 3) fallback estremo: cerca dentro oggetti annidati
  const stack = [deployments];
  while (stack.length) {
    const obj = stack.pop();
    for (const [k, v] of Object.entries(obj || {})) {
      if (isAddressLike(v) && String(k).toLowerCase().includes("factory")) return v;
      if (v && typeof v === "object") stack.push(v);
    }
  }

  return null;
}

const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint256)",
  "function allPairs(uint256) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

function toNumSafe(bn) {
  // per stampa "umana" senza impazzire con BigInt: convertiamo a stringa
  return bn.toString();
}

function formatUnitsStr(raw, decimals) {
  // raw: BigInt o stringa numerica
  const s = typeof raw === "bigint" ? raw.toString() : String(raw);
  const d = Number(decimals);
  if (!Number.isFinite(d) || d < 0) return s;

  // inserisci punto decimale
  if (d === 0) return s;
  const neg = s.startsWith("-");
  const x = neg ? s.slice(1) : s;

  const pad = x.padStart(d + 1, "0");
  const intPart = pad.slice(0, -d);
  const fracPart = pad.slice(-d).replace(/0+$/, ""); // trim trailing zeros
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg ? `-${out}` : out;
}

async function getTokenMeta(address) {
  const token = await hre.ethers.getContractAt(ERC20_ABI, address);
  let symbol = "???";
  let decimals = 18;

  try {
    symbol = await token.symbol();
  } catch (_) {
    // alcuni token possono non implementare symbol() "string"
    symbol = "???";
  }

  try {
    decimals = await token.decimals();
  } catch (_) {
    decimals = 18;
  }

  return { symbol, decimals: Number(decimals) };
}

async function main() {
  const { ethers } = hre;
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const deploymentsPath = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`deployments file non trovato: ${deploymentsPath}`);
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const factoryAddress = pickFactoryAddress(deployments);

  if (!factoryAddress) {
    console.error("Deployments JSON:", deployments);
    throw new Error(
      "Impossibile trovare l'address della Factory nel deployments json. " +
        "Assicurati che ci sia una chiave tipo 'factory' o simile."
    );
  }

  console.log("========================================");
  console.log("SCAN PAIRS");
  console.log(`Network chainId: ${chainId}`);
  console.log(`Factory: ${factoryAddress}`);
  console.log("Deployments file:", deploymentsPath);
  console.log("========================================");

  const factory = await ethers.getContractAt(FACTORY_ABI, factoryAddress);

  const len = await factory.allPairsLength();
  const n = Number(len);

  console.log(`allPairsLength = ${n}`);
  if (n === 0) {
    console.log("Nessuna pair trovata. (Hai già eseguito e2e_stack.js? Quello crea almeno 1 pair.)");
    return;
  }

  const rows = [];

  for (let i = 0; i < n; i++) {
    const pairAddr = await factory.allPairs(i);
    const pair = await ethers.getContractAt(PAIR_ABI, pairAddr);

    const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
    const [m0, m1] = await Promise.all([getTokenMeta(t0), getTokenMeta(t1)]);

    const reserves = await pair.getReserves();
    const r0 = reserves.reserve0; // BigInt in ethers v6
    const r1 = reserves.reserve1;

    const r0Human = formatUnitsStr(r0, m0.decimals);
    const r1Human = formatUnitsStr(r1, m1.decimals);

    // mid price approssimato:
    // price token0 in token1 = (r1 / 10^d1) / (r0 / 10^d0) = (r1 * 10^d0) / (r0 * 10^d1)
    // lo stampiamo come stringa "ratio" semplice evitando float
    let price01 = "n/a";
    let price10 = "n/a";

    try {
      if (r0 !== 0n && r1 !== 0n) {
        const num01 = r1 * 10n ** BigInt(m0.decimals);
        const den01 = r0 * 10n ** BigInt(m1.decimals);
        price01 = `${num01.toString()} / ${den01.toString()}`;

        const num10 = r0 * 10n ** BigInt(m1.decimals);
        const den10 = r1 * 10n ** BigInt(m0.decimals);
        price10 = `${num10.toString()} / ${den10.toString()}`;
      }
    } catch (_) {
      // ignore
    }

    rows.push({
      i,
      pair: pairAddr,
      token0: `${m0.symbol} (${t0})`,
      token1: `${m1.symbol} (${t1})`,
      reserve0: r0Human,
      reserve1: r1Human,
      midPrice_t0_in_t1_ratio: price01,
      midPrice_t1_in_t0_ratio: price10,
    });
  }

  console.table(rows);

  console.log("\nNOTE:");
  console.log("- midPrice_*_ratio è una FRAZIONE (numeratore/denominatore) per evitare float.");
  console.log("- Se vuoi, nel prossimo step la trasformiamo in numero 'human' con precisione controllata.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
