// scripts/seed_pools_1043.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function mustAddr(label, a) {
  if (!a || typeof a !== "string" || !a.startsWith("0x") || a.length !== 42) {
    throw new Error(`Bad address for ${label}: ${a}`);
  }
  return a;
}

const FACTORY_ABI = [
  "function getPair(address,address) view returns(address)",
  "function createPair(address,address) returns(address)",
  "function allPairsLength() view returns(uint256)",
];

const PAIR_ABI = [
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function mint(address) returns(uint256)",
  "function getReserves() view returns(uint112,uint112,uint32)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
  "function transfer(address,uint256) returns(bool)",
];

const WETH_ABI = [
  "function deposit() payable",
  "function balanceOf(address) view returns(uint256)",
  "function decimals() view returns(uint8)",
  "function symbol() view returns(string)",
  "function transfer(address,uint256) returns(bool)",
];

function bn(x) {
  return BigInt(x);
}

function fmtUnits(raw, dec) {
  const s = raw.toString();
  if (dec === 0) return s;
  const neg = s.startsWith("-");
  const t = neg ? s.slice(1) : s;
  const pad = t.padStart(dec + 1, "0");
  const a = pad.slice(0, -dec);
  const b = pad.slice(-dec).replace(/0+$/, "");
  return (neg ? "-" : "") + (b ? `${a}.${b}` : a);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitGetPair(factory, tokenA, tokenB, tries = 10, delayMs = 1200) {
  for (let i = 0; i < tries; i++) {
    const p = await factory.getPair(tokenA, tokenB);
    if (p && p !== "0x0000000000000000000000000000000000000000") return p;
    await sleep(delayMs);
  }
  return "0x0000000000000000000000000000000000000000";
}

async function ensurePair(factory, tokenA, tokenB, gasLimitCreate) {
  let pair = await factory.getPair(tokenA, tokenB);
  if (pair && pair !== "0x0000000000000000000000000000000000000000") return pair;

  console.log(`Creating pair (HIGH GAS): ${tokenA} / ${tokenB}`);
  const tx = await factory.createPair(tokenA, tokenB, { gasLimit: gasLimitCreate });
  console.log(" - tx:", tx.hash);

  const rc = await tx.wait();
  if (rc.status !== 1) throw new Error("createPair failed");

  // RPC/indexing can lag: poll getPair
  pair = await waitGetPair(factory, tokenA, tokenB, 12, 1200);
  return pair;
}

async function getTokenMeta(provider, addr, isWethLike = false) {
  const c = new hre.ethers.Contract(addr, isWethLike ? WETH_ABI : ERC20_ABI, provider);
  const [sym, dec] = await Promise.all([c.symbol().catch(() => "TOKEN"), c.decimals().catch(() => 18)]);
  return { addr, sym, dec: Number(dec), c };
}

async function printPairState(provider, pairAddr) {
  const pair = new hre.ethers.Contract(pairAddr, PAIR_ABI, provider);
  const [t0, t1, rs] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  console.log("Pair:", pairAddr);
  console.log(" - token0:", t0);
  console.log(" - token1:", t1);
  console.log(" - reserves:", rs[0].toString(), rs[1].toString(), "ts:", rs[2].toString());
}

async function seedPairSafeMode({
  provider,
  signer,
  factory,
  tokenA,
  tokenB,
  amountA,
  amountB,
  gasLimitCreate = 4_500_000,
  gasLimitMint = 8_000_000,
}) {
  const me = await signer.getAddress();

  const pairAddr = await ensurePair(factory, tokenA.addr, tokenB.addr, gasLimitCreate);
  if (pairAddr === "0x0000000000000000000000000000000000000000") {
    throw new Error("Pair address is still 0x0 after createPair (RPC/indexing lag too high). Re-run seed.");
  }
  console.log(`Pair address: ${pairAddr}`);

  const [balA, balB] = await Promise.all([tokenA.c.balanceOf(me), tokenB.c.balanceOf(me)]);
  const balARaw = bn(balA);
  const balBRaw = bn(balB);

  console.log(
    `Balances: ${tokenA.sym}=${fmtUnits(balARaw, tokenA.dec)} | ${tokenB.sym}=${fmtUnits(balBRaw, tokenB.dec)}`
  );
  console.log(
    `Need:     ${tokenA.sym}=${fmtUnits(amountA, tokenA.dec)} | ${tokenB.sym}=${fmtUnits(amountB, tokenB.dec)}`
  );

  if (balARaw < amountA) throw new Error(`${tokenA.sym} insufficient. Have=${balARaw} Need=${amountA}`);
  if (balBRaw < amountB) throw new Error(`${tokenB.sym} insufficient. Have=${balBRaw} Need=${amountB}`);

  console.log("Seeding pair via direct transfers...");
  const tx1 = await tokenA.c.connect(signer).transfer(pairAddr, amountA, { gasLimit: 300_000 });
  console.log(` - ${tokenA.sym} transfer tx:`, tx1.hash);
  const rc1 = await tx1.wait();
  if (rc1.status !== 1) throw new Error(`${tokenA.sym} transfer failed`);

  const tx2 = await tokenB.c.connect(signer).transfer(pairAddr, amountB, { gasLimit: 300_000 });
  console.log(` - ${tokenB.sym} transfer tx:`, tx2.hash);
  const rc2 = await tx2.wait();
  if (rc2.status !== 1) throw new Error(`${tokenB.sym} transfer failed`);

  console.log("Transfers OK.");

  console.log("Minting LP (HIGH GAS) ...");
  const pairW = new hre.ethers.Contract(pairAddr, PAIR_ABI, signer);
  const txM = await pairW.mint(me, { gasLimit: gasLimitMint });
  console.log(" - mint tx:", txM.hash);
  const rcM = await txM.wait();
  if (rcM.status !== 1) throw new Error("mint failed");

  console.log("LP mint OK.");
  await printPairState(provider, pairAddr);

  return pairAddr;
}

async function main() {
  const { ethers, network } = hre;
  const provider = ethers.provider;

  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("========================================");
  console.log("SEED POOLS — TESTNET 1043 (SAFE MODE)");
  console.log(`Network: ${network.name}`);
  console.log(`ChainId: ${chainId}`);
  console.log("========================================");

  if (chainId !== 1043) throw new Error(`Run this only on chainId 1043. Got ${chainId}`);

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();

  const depPath = path.join(__dirname, "..", "deployments", "1043.json");
  const dep = readJson(depPath);

  const FACTORY = mustAddr("factory", dep.factory);
  const ROUTER = mustAddr("router", dep.router);
  const WBDAG = mustAddr("wrappedNative", dep.wrappedNative || dep.weth || dep.wrapped);

  const TST = mustAddr("TST stable", "0x0FAcF9368ac69fD9F0A7e8F0B7A677378AA10738");
  const MOCK_USDCV2 = mustAddr("MockUSDCv2", "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2");
  const BDAG = mustAddr("BDAG", "0x2FDA21376534Acc71F8D1689959B48818eb4B869");

  console.log("Me:", me);
  console.log("Factory:", FACTORY);
  console.log("Router:", ROUTER);
  console.log("WBDAG:", WBDAG);
  console.log("MockUSDCv2:", MOCK_USDCV2);
  console.log("TST:", TST);
  console.log("BDAG:", BDAG);
  console.log("========================================");

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, signer);

  const wbdag = await getTokenMeta(provider, WBDAG, true);
  const usdc = await getTokenMeta(provider, MOCK_USDCV2, false);
  const tst = await getTokenMeta(provider, TST, false);
  const bdag = await getTokenMeta(provider, BDAG, false);

  // -----------------------
  // POOL 1) WBDAG / TST
  // -----------------------
  console.log("========================================");
  console.log("SEED: WBDAG / TST");
  console.log("========================================");

  const amtW_forTst = 10n ** 16n; // 0.01 WBDAG
  const amtTst = 200_000n * 10n ** bn(tst.dec); // <<< lowered (you have ~463k)

  await seedPairSafeMode({
    provider,
    signer,
    factory,
    tokenA: tst,
    tokenB: wbdag,
    amountA: amtTst,
    amountB: amtW_forTst,
  });

  // -----------------------
  // POOL 2) WBDAG / MockUSDCv2
  // -----------------------
  console.log("========================================");
  console.log("SEED: WBDAG / MockUSDCv2");
  console.log("========================================");

  const amtW_forUsdc = 10n ** 16n; // 0.01 WBDAG
  const amtUsdc = 500n * 10n ** bn(usdc.dec); // 500 USDC (keep some buffer)

  await seedPairSafeMode({
    provider,
    signer,
    factory,
    tokenA: usdc,
    tokenB: wbdag,
    amountA: amtUsdc,
    amountB: amtW_forUsdc,
  });

  // -----------------------
  // OPTIONAL: BDAG / MockUSDCv2
  // -----------------------
  console.log("========================================");
  console.log("OPTIONAL SEED: BDAG / MockUSDCv2");
  console.log("========================================");

  const bdagBal = bn(await bdag.c.balanceOf(me));
  const usdcBal = bn(await usdc.c.balanceOf(me));

  const amtBdag = 100n * 10n ** bn(bdag.dec);
  const amtUsdcSmall = 100n * 10n ** bn(usdc.dec);

  if (bdagBal >= amtBdag && usdcBal >= amtUsdcSmall) {
    await seedPairSafeMode({
      provider,
      signer,
      factory,
      tokenA: bdag,
      tokenB: usdc,
      amountA: amtBdag,
      amountB: amtUsdcSmall,
    });
  } else {
    console.log(
      `Skipping BDAG/USDC seed (insufficient): BDAG=${fmtUnits(bdagBal, bdag.dec)} USDC=${fmtUnits(usdcBal, usdc.dec)}`
    );
  }

  const n = await factory.allPairsLength();
  console.log("========================================");
  console.log("DONE. allPairsLength =", n.toString());
  console.log("========================================");
}

main().catch((e) => {
  console.error("SEED FAILED:", e?.shortMessage || e?.message || String(e));
  process.exit(1);
});
