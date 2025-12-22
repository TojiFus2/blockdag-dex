/* scripts/seed_wbdag_usdc_via_router_struct_1043.js
 *
 * Robust seed script for V2RouterLite2.addLiquidityETH(AddLiquidityETHParams)
 * - Uses NEW WUSDC address
 * - Adds retry to flaky view calls (eth_call returning empty/garbage)
 *
 * Run:
 *   npx hardhat run --network bdagTestnet scripts/seed_wbdag_usdc_via_router_struct_1043.js
 */

const hre = require("hardhat");
const { ethers } = hre;

const CFG = {
  chainId: 1043,
  ROUTER: "0xe29D2A1F36c5D86929BE895A72FBFEED83841a1C",
  FACTORY: "0xa06F091b46da5e53D8d8F1D7519150E29d91e291",
  // NOTE: WBDAG will be taken from router.WETH() for sanity
  WUSDC: "0xd7eFc4e37306b379C88DBf8749189C480bfEA340", // NEW MockUSDCv2 (6 dec)
};

const AMOUNTS = {
  eth: "1.0",     // 1 BDAG native
  usdc: "1000",   // 1000 USDC (6 dec)
};

const GAS = {
  APPROVE: 600_000,
  LIQ: 8_000_000,
};

const ROUTER_ABI = [
  "function addLiquidityETH((address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) p) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)",
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) external view returns (address)",
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
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner,address spender) external view returns (uint256)",
  "function approve(address spender,uint256 value) external returns (bool)",
];

function isZero(a) {
  return !a || a.toLowerCase() === ethers.ZeroAddress.toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retryView(fn, retries = 6, delayMs = 450) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const v = await fn();
      // ethers sometimes returns "0x" / empty; treat as failure
      if (typeof v === "string" && v === "0x") throw new Error("Empty 0x view result");
      return v;
    } catch (e) {
      last = e;
      if (i === retries - 1) throw last;
      await sleep(delayMs);
    }
  }
  throw last;
}

function shortErr(e) {
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

async function tryGetPair(factory, a, b) {
  try {
    return await retryView(() => factory.getPair(a, b));
  } catch (e) {
    console.log("getPair(view) FAILED:", shortErr(e));
    return ethers.ZeroAddress;
  }
}

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log("Network chainId:", Number(net.chainId));
  if (Number(net.chainId) !== CFG.chainId) console.log("WARNING: unexpected chainId");

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Deployer:", me);

  const router = new ethers.Contract(CFG.ROUTER, ROUTER_ABI, signer);
  const factory = new ethers.Contract(CFG.FACTORY, FACTORY_ABI, ethers.provider);
  const usdc = new ethers.Contract(CFG.WUSDC, ERC20_ABI, signer);

  const [rf, rw] = await Promise.all([
    retryView(() => router.factory()),
    retryView(() => router.WETH()),
  ]);

  console.log("router.factory():", rf);
  console.log("router.WETH():", rw);

  // Sanity: force WBDAG from router.WETH()
  const WBDAG = rw;
  const WUSDC = CFG.WUSDC;

  const [sym, dec] = await Promise.all([
    retryView(() => usdc.symbol()).catch(() => "USDC"),
    retryView(() => usdc.decimals()),
  ]);

  const balUsdc = await retryView(() => usdc.balanceOf(me));
  const balNative = await retryView(() => ethers.provider.getBalance(me));

  console.log(`${sym} decimals:`, dec.toString());
  console.log(`${sym} balance:`, ethers.formatUnits(balUsdc, Number(dec)));
  console.log("native balance:", ethers.formatEther(balNative));

  const amountTokenDesired = ethers.parseUnits(AMOUNTS.usdc, Number(dec));
  const amountETHDesired = ethers.parseEther(AMOUNTS.eth);

  if (balUsdc < amountTokenDesired) {
    throw new Error(`INSUFFICIENT USDC. Have ${ethers.formatUnits(balUsdc, Number(dec))}, need ${AMOUNTS.usdc}`);
  }
  if (balNative < amountETHDesired) {
    throw new Error(`INSUFFICIENT BDAG. Have ${ethers.formatEther(balNative)}, need ${AMOUNTS.eth}`);
  }

  // Best-effort getPair before (may fail on flaky RPC)
  const beforePair = await tryGetPair(factory, WBDAG, WUSDC);
  console.log("pair before:", beforePair);

  // Approve if needed (retry allowance)
  const allowance = await retryView(() => usdc.allowance(me, CFG.ROUTER));
  if (allowance < amountTokenDesired) {
    const txA = await usdc.approve(CFG.ROUTER, amountTokenDesired, { gasLimit: GAS.APPROVE });
    console.log("approve tx:", txA.hash);
    await txA.wait();
    console.log("approve OK");
  } else {
    console.log("approve: already sufficient");
  }

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  console.log("Calling addLiquidityETH(struct) ...");
  const txL = await router.addLiquidityETH(
    {
      token: WUSDC,
      amountTokenDesired,
      amountTokenMin: 0,
      amountETHMin: 0,
      to: me,
      deadline,
    },
    { value: amountETHDesired, gasLimit: GAS.LIQ }
  );

  console.log("addLiquidityETH tx:", txL.hash);
  const rec = await txL.wait();
  console.log("addLiquidityETH OK. status:", rec.status);

  // Try getPair after (retry)
  let pair = await tryGetPair(factory, WBDAG, WUSDC);
  console.log("pair after:", pair);

  // If still ZERO, attempt fallback by scanning last pairs (best-effort)
  if (isZero(pair)) {
    console.log("pair after is ZERO (or getPair flaky). Trying fallback scan via allPairs...");
    try {
      const nPairs = await retryView(() => factory.allPairsLength());
      const len = Number(nPairs);
      console.log("allPairsLength:", len);

      const tail = Math.max(0, len - 10);
      for (let i = len - 1; i >= tail; i--) {
        const p = await retryView(() => factory.allPairs(i));
        if (isZero(p)) continue;

        const pairC = new ethers.Contract(p, PAIR_ABI, ethers.provider);
        const [t0, t1] = await Promise.all([retryView(() => pairC.token0()), retryView(() => pairC.token1())]);

        const ok =
          (t0.toLowerCase() === WBDAG.toLowerCase() && t1.toLowerCase() === WUSDC.toLowerCase()) ||
          (t1.toLowerCase() === WBDAG.toLowerCase() && t0.toLowerCase() === WUSDC.toLowerCase());

        if (ok) {
          pair = p;
          console.log("fallback found pair:", pair);
          break;
        }
      }
    } catch (e) {
      console.log("fallback scan FAILED:", shortErr(e));
    }
  }

  if (isZero(pair)) {
    throw new Error("Could not confirm pair address (RPC view calls too flaky). But liquidity tx was mined.");
  }

  const pairC = new ethers.Contract(pair, PAIR_ABI, ethers.provider);
  const [t0, t1, r] = await Promise.all([
    retryView(() => pairC.token0()),
    retryView(() => pairC.token1()),
    retryView(() => pairC.getReserves()),
  ]);

  console.log("token0:", t0);
  console.log("token1:", t1);
  console.log("reserves:", r.reserve0.toString(), "/", r.reserve1.toString());

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error("ERROR:", shortErr(e));
  process.exitCode = 1;
});
