/* scripts/seed_tst_usdc_direct_mint_1043.js
 *
 * Seed a token/token UniswapV2 pool WITHOUT router:
 *  - getPair/createPair
 *  - transfer tokenA + tokenB to pair
 *  - pair.mint(to)
 *
 * Run:
 *   npx hardhat run --network bdagTestnet scripts/seed_tst_usdc_direct_mint_1043.js
 */

const hre = require("hardhat");
const { ethers } = hre;

const CFG = {
  chainId: 1043,
  FACTORY: "0xa06F091b46da5e53D8d8F1D7519150E29d91e291",

  // Tokens (testnet 1043)
  TST:  "0x0FAcF9368ac69fD9F0A7e8F0B7A677378AA10738",
  USDC: "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2", // MockUSDCv2 (6 dec)
};

// Choose amounts you want to seed (human units)
const AMOUNTS = {
  TST:  "1000",  // 1000 TST
  USDC: "100",   // 100 USDC  (metti 1000 se ne hai abbastanza)
};

// Flaky RPC => generous gas
const GAS = {
  TRANSFER: 600_000,
  MINT: 2_500_000,
  CREATE_PAIR: 3_000_000,
};

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address)",
  "function createPair(address tokenA,address tokenB) external returns (address)",
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

function short(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retry(fn, { retries = 4, delayMs = 600, label = "op" } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      console.log(`[retry] ${label} failed (${i + 1}/${retries}): ${msg}`);
      if (i === retries - 1) throw e;
      await sleep(delayMs);
    }
  }
  throw last;
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const cid = Number(net.chainId);
  console.log("Network chainId:", cid);
  if (cid !== CFG.chainId) console.log("WARNING: unexpected chainId, expected", CFG.chainId);

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Deployer:", me);

  const factory = new ethers.Contract(CFG.FACTORY, FACTORY_ABI, signer);

  const tst = new ethers.Contract(CFG.TST, ERC20_ABI, signer);
  const usdc = new ethers.Contract(CFG.USDC, ERC20_ABI, signer);

  const [tstSym, tstDec, usdcSym, usdcDec] = await Promise.all([
    tst.symbol().catch(() => "TST"),
    tst.decimals(),
    usdc.symbol().catch(() => "USDC"),
    usdc.decimals(),
  ]);

  console.log(`${tstSym} decimals:`, tstDec.toString());
  console.log(`${usdcSym} decimals:`, usdcDec.toString());

  const amtTst = ethers.parseUnits(AMOUNTS.TST, Number(tstDec));
  const amtUsdc = ethers.parseUnits(AMOUNTS.USDC, Number(usdcDec));

  const [balTst, balUsdc] = await Promise.all([tst.balanceOf(me), usdc.balanceOf(me)]);
  console.log(`${tstSym} balance:`, ethers.formatUnits(balTst, Number(tstDec)));
  console.log(`${usdcSym} balance:`, ethers.formatUnits(balUsdc, Number(usdcDec)));

  if (balTst < amtTst) {
    throw new Error(`Insufficient ${tstSym}. Need ${AMOUNTS.TST}, have ${ethers.formatUnits(balTst, Number(tstDec))}`);
  }
  if (balUsdc < amtUsdc) {
    throw new Error(`Insufficient ${usdcSym}. Need ${AMOUNTS.USDC}, have ${ethers.formatUnits(balUsdc, Number(usdcDec))}`);
  }

  // 1) getPair / createPair
  let pair = await retry(() => factory.getPair(CFG.TST, CFG.USDC), { label: "factory.getPair" });
  console.log("pair before:", pair);

  if (isZero(pair)) {
    console.log("pair missing -> creating via factory.createPair...");
    const txC = await retry(
      () => factory.createPair(CFG.TST, CFG.USDC, { gasLimit: GAS.CREATE_PAIR }),
      { label: "factory.createPair" }
    );
    console.log("createPair tx:", txC.hash);
    await retry(() => txC.wait(), { label: "createPair wait" });

    pair = await retry(() => factory.getPair(CFG.TST, CFG.USDC), { label: "factory.getPair(after)" });
    console.log("pair after:", pair);
    if (isZero(pair)) throw new Error("Pair is still ZERO after createPair. Something is wrong.");
  }

  const pairC = new ethers.Contract(pair, PAIR_ABI, signer);

  // Optional: show token0/token1
  const [token0, token1] = await Promise.all([pairC.token0(), pairC.token1()]);
  console.log("token0:", token0, token0.toLowerCase() === CFG.TST.toLowerCase() ? `(${tstSym})` : "");
  console.log("token1:", token1, token1.toLowerCase() === CFG.USDC.toLowerCase() ? `(${usdcSym})` : "");

  // 2) transfer tokens to pair
  console.log(`transferring ${AMOUNTS.TST} ${tstSym} -> pair ${short(pair)} ...`);
  const txT = await retry(() => tst.transfer(pair, amtTst, { gasLimit: GAS.TRANSFER }), { label: `${tstSym}.transfer` });
  console.log(`${tstSym} transfer tx:`, txT.hash);
  await retry(() => txT.wait(), { label: `${tstSym} transfer wait` });

  console.log(`transferring ${AMOUNTS.USDC} ${usdcSym} -> pair ${short(pair)} ...`);
  const txU = await retry(() => usdc.transfer(pair, amtUsdc, { gasLimit: GAS.TRANSFER }), { label: `${usdcSym}.transfer` });
  console.log(`${usdcSym} transfer tx:`, txU.hash);
  await retry(() => txU.wait(), { label: `${usdcSym} transfer wait` });

  // 3) mint LP to me
  console.log("calling pair.mint(me) ...");
  const txM = await retry(() => pairC.mint(me, { gasLimit: GAS.MINT }), { label: "pair.mint" });
  console.log("mint tx:", txM.hash);
  await retry(() => txM.wait(), { label: "mint wait" });
  console.log("mint OK");

  // 4) print reserves
  const r = await retry(() => pairC.getReserves(), { label: "pair.getReserves" });
  console.log("reserves raw:", r.reserve0.toString(), "/", r.reserve1.toString());

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error("ERROR:", e?.shortMessage || e?.reason || e?.message || e);
  process.exitCode = 1;
});
