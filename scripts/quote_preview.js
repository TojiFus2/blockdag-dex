// scripts/quote_preview.js
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/*
QUOTE PREVIEW — CONFIG FISSA (NO CLI ARGS)

- pairIndex: 0
- direction: token0 -> token1
- amountIn: 0.1 (human)
- slippage: 0.50%
*/

const PAIR_INDEX = 0;
const DIRECTION_0_TO_1 = true; // true = token0 -> token1
const AMOUNT_IN_HUMAN = "0.1";
const SLIPPAGE_BPS = 50; // 0.50%

const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint256)",
  "function allPairs(uint256) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32)",
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

function pickFactoryAddress(deployments) {
  for (const [k, v] of Object.entries(deployments)) {
    if (k.toLowerCase().includes("factory") && /^0x[a-fA-F0-9]{40}$/.test(v)) {
      return v;
    }
  }
  throw new Error("Factory address non trovata nel deployments json");
}

function pow10(n) {
  return 10n ** BigInt(n);
}

function parseUnitsHuman(value, decimals) {
  const [i, f = ""] = value.split(".");
  const frac = f.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(i) * pow10(decimals) + BigInt(frac);
}

function formatUnits(raw, decimals) {
  const s = raw.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

// Uniswap V2 formula (fee 0.30%)
function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

async function getTokenMeta(addr) {
  const t = await hre.ethers.getContractAt(ERC20_ABI, addr);
  return {
    symbol: await t.symbol(),
    decimals: Number(await t.decimals()),
  };
}

async function main() {
  const { ethers } = hre;
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const deploymentsPath = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const factoryAddr = pickFactoryAddress(deployments);

  const factory = await ethers.getContractAt(FACTORY_ABI, factoryAddr);
  const pairAddr = await factory.allPairs(PAIR_INDEX);
  const pair = await ethers.getContractAt(PAIR_ABI, pairAddr);

  const [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
  const [m0, m1] = await Promise.all([getTokenMeta(t0), getTokenMeta(t1)]);
  const { reserve0, reserve1 } = await pair.getReserves();

  const tokenIn = DIRECTION_0_TO_1 ? m0 : m1;
  const tokenOut = DIRECTION_0_TO_1 ? m1 : m0;
  const reserveIn = DIRECTION_0_TO_1 ? reserve0 : reserve1;
  const reserveOut = DIRECTION_0_TO_1 ? reserve1 : reserve0;

  const amountInRaw = parseUnitsHuman(AMOUNT_IN_HUMAN, tokenIn.decimals);
  const amountOutRaw = getAmountOut(amountInRaw, reserveIn, reserveOut);
  const minOutRaw = (amountOutRaw * (10000n - BigInt(SLIPPAGE_BPS))) / 10000n;

  console.log("========================================");
  console.log("QUOTE PREVIEW (Uniswap V2 – deterministic)");
  console.log(`chainId: ${chainId}`);
  console.log(`pair: ${pairAddr}`);
  console.log("----------------------------------------");
  console.log(`direction: ${DIRECTION_0_TO_1 ? "token0 -> token1" : "token1 -> token0"}`);
  console.log(`amountIn: ${AMOUNT_IN_HUMAN} ${tokenIn.symbol}`);
  console.log(`amountOut: ${formatUnits(amountOutRaw, tokenOut.decimals)} ${tokenOut.symbol}`);
  console.log(`minOut (${SLIPPAGE_BPS} bps): ${formatUnits(minOutRaw, tokenOut.decimals)} ${tokenOut.symbol}`);
  console.log("----------------------------------------");
  console.log(`reserves:`);
  console.log(`- token0: ${formatUnits(reserve0, m0.decimals)} ${m0.symbol}`);
  console.log(`- token1: ${formatUnits(reserve1, m1.decimals)} ${m1.symbol}`);
  console.log("========================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
