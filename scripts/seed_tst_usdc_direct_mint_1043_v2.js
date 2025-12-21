/* scripts/seed_tst_usdc_direct_mint_1043_v2.js
 *
 * Robust seed for token/token UniswapV2 pool on flaky RPC:
 *  - getPair (retry)
 *  - if zero => scan allPairs for matching token0/token1
 *  - if still missing => createPair (high gas)
 *  - if createPair "reverts" => scan again (often PAIR_EXISTS / RPC lie)
 *  - transfer tokenA+tokenB to pair
 *  - pair.mint(to)
 *
 * Run:
 *   npx hardhat run --network bdagTestnet scripts/seed_tst_usdc_direct_mint_1043_v2.js
 */

const hre = require("hardhat");
const { ethers } = hre;

const CFG = {
  chainId: 1043,
  FACTORY: "0xa06F091b46da5e53D8d8F1D7519150E29d91e291",
  TST:  "0x0FAcF9368ac69fD9F0A7e8F0B7A677378AA10738",
  USDC: "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2", // MockUSDCv2 (6 dec)
};

// amounts in human units
const AMOUNTS = {
  TST:  "1000",
  USDC: "100",
};

const GAS = {
  TRANSFER: 800_000,
  MINT: 3_500_000,
  CREATE_PAIR: 8_000_000,
};

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address)",
  "function createPair(address tokenA,address tokenB) external returns (address)",
  "function allPairsLength() external view returns (uint256)",
  "function allPairs(uint256) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function mint(address to) external returns (uint256 liquidity)",
];

const ERC20_ABI = [
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function transfer(address to, uint256 value) external returns (bool)",
];

function isZero(a) {
  return !a || a.toLowerCase() === ethers.ZeroAddress.toLowerCase();
}

function same(a, b) {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function short(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

async function retry(fn, { retries = 6, delayMs = 700, label = "op" } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`[retry] ${label} failed (${i + 1}/${retries}): ${errMsg(e)}`);
      if (i === retries - 1) throw e;
      await sleep(delayMs);
    }
  }
  throw last;
}

async function scanPairsFor(factory, provider, tokenA, tokenB, maxScan = 200) {
  const len = await retry(() => factory.allPairsLength(), { label: "factory.allPairsLength" });
  const n = Number(len);
  const scanN = Math.min(n, maxScan);

  console.log(`scanPairs: total=${n}, scanning first=${scanN}`);

  for (let i = 0; i < scanN; i++) {
    const p = await retry(() => factory.allPairs(i), { label: `factory.allPairs(${i})`, delayMs: 500, retries: 4 });
    if (isZero(p)) continue;

    const pair = new ethers.Contract(p, PAIR_ABI, provider);
    let t0, t1;
    try {
      [t0, t1] = await Promise.all([pair.token0(), pair.token1()]);
    } catch {
      continue;
    }

    const match =
      (same(t0, tokenA) && same(t1, tokenB)) ||
      (same(t0, tokenB) && same(t1, tokenA));

    if (match) {
      console.log(`scanPairs: FOUND at index ${i}: ${p}`);
      return p;
    }
  }

  console.log("scanPairs: not found in scanned range");
  return ethers.ZeroAddress;
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const cid = Number(net.chainId);
  console.log("Network chainId:", cid);
  if (cid !== CFG.chainId) console.log("WARNING: expected chainId", CFG.chainId);

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Deployer:", me);

  const factory = new ethers.Contract(CFG.FACTORY, FACTORY_ABI, signer);

  const tst = new ethers.Contract(CFG.TST, ERC20_ABI, signer);
  const usdc = new ethers.Contract(CFG.USDC, ERC20_ABI, signer);

  const [tstDec, usdcDec] = await Promise.all([tst.decimals(), usdc.decimals()]);
  console.log("TST decimals:", tstDec.toString());
  console.log("USDC decimals:", usdcDec.toString());

  const amtTst = ethers.parseUnits(AMOUNTS.TST, Number(tstDec));
  const amtUsdc = ethers.parseUnits(AMOUNTS.USDC, Number(usdcDec));

  const [balTst, balUsdc] = await Promise.all([tst.balanceOf(me), usdc.balanceOf(me)]);
  console.log("TST balance:", ethers.formatUnits(balTst, Number(tstDec)));
  console.log("USDC balance:", ethers.formatUnits(balUsdc, Number(usdcDec)));

  if (balTst < amtTst) throw new Error(`Insufficient TST. Need ${AMOUNTS.TST}`);
  if (balUsdc < amtUsdc) throw new Error(`Insufficient USDC. Need ${AMOUNTS.USDC}`);

  // 1) getPair (retry hard)
  let pair = await retry(() => factory.getPair(CFG.TST, CFG.USDC), { label: "factory.getPair", retries: 8, delayMs: 600 });
  console.log("pair (getPair):", pair);

  // 2) if zero => scan fallback
  if (isZero(pair)) {
    pair = await scanPairsFor(factory, signer.provider, CFG.TST, CFG.USDC, 400);
    console.log("pair (scan):", pair);
  }

  // 3) if still zero => try createPair
  if (isZero(pair)) {
    console.log("pair missing -> trying factory.createPair (high gas) ...");

    // staticCall to capture revert reason if any
    try {
      await factory.createPair.staticCall(CFG.TST, CFG.USDC);
      console.log("createPair.staticCall: OK (should be creatable)");
    } catch (e) {
      console.log("createPair.staticCall revert reason (best-effort):", errMsg(e));
    }

    try {
      const txC = await retry(() => factory.createPair(CFG.TST, CFG.USDC, { gasLimit: GAS.CREATE_PAIR }), {
        label: "factory.createPair(send)",
        retries: 3,
        delayMs: 900,
      });
      console.log("createPair tx:", txC.hash);

      // wait might lie on flaky RPC; even if it errors, we continue with scan
      try {
        const rc = await retry(() => txC.wait(), { label: "createPair wait", retries: 4, delayMs: 1200 });
        console.log("createPair mined status:", rc.status);
      } catch (e) {
        console.log("createPair wait error (will scan anyway):", errMsg(e));
      }
    } catch (e) {
      console.log("createPair send error (will scan anyway):", errMsg(e));
    }

    // always re-check after attempt
    pair = await retry(() => factory.getPair(CFG.TST, CFG.USDC), { label: "factory.getPair(after create)", retries: 8, delayMs: 700 });
    if (isZero(pair)) {
      pair = await scanPairsFor(factory, signer.provider, CFG.TST, CFG.USDC, 800);
    }

    console.log("pair (after create/scan):", pair);
    if (isZero(pair)) throw new Error("Pair is still ZERO after create+scan. Cannot proceed.");
  }

  // 4) transfer + mint
  const pairC = new ethers.Contract(pair, PAIR_ABI, signer);

  const [t0, t1] = await Promise.all([pairC.token0(), pairC.token1()]);
  console.log("pair token0:", t0);
  console.log("pair token1:", t1);

  console.log(`transfer ${AMOUNTS.TST} TST -> pair ${short(pair)} ...`);
  const txT = await retry(() => tst.transfer(pair, amtTst, { gasLimit: GAS.TRANSFER }), { label: "TST.transfer" });
  console.log("TST transfer tx:", txT.hash);
  await retry(() => txT.wait(), { label: "TST.transfer wait" });

  console.log(`transfer ${AMOUNTS.USDC} USDC -> pair ${short(pair)} ...`);
  const txU = await retry(() => usdc.transfer(pair, amtUsdc, { gasLimit: GAS.TRANSFER }), { label: "USDC.transfer" });
  console.log("USDC transfer tx:", txU.hash);
  await retry(() => txU.wait(), { label: "USDC.transfer wait" });

  console.log("pair.mint(me) ...");
  const txM = await retry(() => pairC.mint(me, { gasLimit: GAS.MINT }), { label: "pair.mint" });
  console.log("mint tx:", txM.hash);
  await retry(() => txM.wait(), { label: "mint wait" });
  console.log("mint OK");

  const r = await retry(() => pairC.getReserves(), { label: "pair.getReserves" });
  console.log("reserves raw:", r.reserve0.toString(), "/", r.reserve1.toString());

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error("ERROR:", errMsg(e));
  process.exitCode = 1;
});
