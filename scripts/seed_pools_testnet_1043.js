/* scripts/seed_pools_testnet_1043.js
 *
 * Seed stable demo pools on BlockDAG testnet (chainId 1043)
 * - Creates WBDAG/MockUSDCv2 with addLiquidityETH (router)
 * - Tries TST/MockUSDCv2 with addLiquidity if router supports it (optional)
 *
 * Run:
 *   npx hardhat run --network bdagTestnet scripts/seed_pools_testnet_1043.js
 */

const hre = require("hardhat");
const { ethers } = hre;

// --------- CONFIG (fallbacks from your UI Debug) ----------
const FALLBACK = {
  chainId: 1043,
  factory: "0xa06F091b46da5e53D8d8F1D7519150E29d91e291",
  router: "0xe29D2A1F36c5D86929BE895A72FBFEED83841a1C",
  wbdg: "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289",
  usdc: "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2", // MockUSDCv2 (6 dec)
  tst: "0x0FAcF9368ac69fD9F0A7e8F0B7A677378AA10738",
};

const AMOUNTS = {
  // pool 1 (WBDAG/USDC)
  wbdg: "1.0",      // BDAG native value to send (1 BDAG)
  usdc: "1000",     // 1000 USDC (6 decimals handled)
  // pool 2 (TST/USDC) optional
  tst: "1000",      // 1000 TST
  usdc2: "1000",
};

const GAS = {
  approve: 600_000,
  liq: 8_000_000,
};

const DEADLINE_MIN = 20;

// --------- ABIs ----------
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address)",
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32)",
];

const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function approve(address spender, uint256 value) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function symbol() external view returns (string)",
];

const ROUTER_ABI = [
  "function addLiquidityETH(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,address to,uint deadline) payable returns (uint amountToken,uint amountETH,uint liquidity)",
  // optional (may not exist in your router)
  "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB,uint liquidity)",
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
];

// --------- Helpers ----------
function nowDeadline() {
  return Math.floor(Date.now() / 1000) + 60 * DEADLINE_MIN;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retry(label, fn, retries = 4, delayMs = 700) {
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

async function getDeploymentMaybe(name) {
  // tries common patterns; if your loadDeployments is different, fallback used.
  try {
    const d = await hre.deployments.get(name);
    return d?.address;
  } catch {
    return null;
  }
}

async function printPairInfo(provider, pairAddr) {
  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const [t0, t1, r] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  console.log("pair:", pairAddr);
  console.log("token0:", t0);
  console.log("token1:", t1);
  console.log("reserves:", r.reserve0.toString(), "/", r.reserve1.toString());
}

// --------- Main ----------
async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  console.log("Network chainId:", chainId);

  if (chainId !== FALLBACK.chainId) {
    console.log(`WARNING: expected chainId ${FALLBACK.chainId}, got ${chainId}. Continuing anyway...`);
  }

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Deployer:", me);

  // Try to get router/factory from deployments; otherwise use fallback from UI Debug.
  const depRouter =
    (await getDeploymentMaybe("V2RouterLite2")) ||
    (await getDeploymentMaybe("Router")) ||
    null;
  const depFactory =
    (await getDeploymentMaybe("UniswapV2Factory")) ||
    (await getDeploymentMaybe("Factory")) ||
    null;

  const routerAddr = depRouter || FALLBACK.router;
  const factoryAddr = depFactory || FALLBACK.factory;

  console.log("router:", routerAddr);
  console.log("factory:", factoryAddr);

  const router = new ethers.Contract(routerAddr, ROUTER_ABI, signer);
  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, ethers.provider);

  // Validate router->factory & router->WETH, but don't hard fail if flaky.
  const routerFactory = await retry("router.factory()", async () => router.factory());
  const routerWETH = await retry("router.WETH()", async () => router.WETH());
  console.log("router.factory():", routerFactory);
  console.log("router.WETH():", routerWETH);

  const WBDAG = routerWETH; // source of truth
  const USDC = FALLBACK.usdc;
  const TST = FALLBACK.tst;

  // Contracts
  const usdc = new ethers.Contract(USDC, ERC20_ABI, signer);
  const tst = new ethers.Contract(TST, ERC20_ABI, signer);

  const usdcDec = Number(await retry("usdc.decimals()", async () => usdc.decimals()));
  const tstDec = Number(await retry("tst.decimals()", async () => tst.decimals()));
  const [usdcSym, tstSym] = await Promise.all([
    retry("usdc.symbol()", async () => usdc.symbol()).catch(() => "USDC"),
    retry("tst.symbol()", async () => tst.symbol()).catch(() => "TST"),
  ]);

  // Balances
  const [nativeBal, usdcBal, tstBal] = await Promise.all([
    ethers.provider.getBalance(me),
    retry("usdc.balanceOf()", async () => usdc.balanceOf(me)),
    retry("tst.balanceOf()", async () => tst.balanceOf(me)),
  ]);

  console.log("native balance:", ethers.formatEther(nativeBal));
  console.log(`${usdcSym} balance:`, ethers.formatUnits(usdcBal, usdcDec));
  console.log(`${tstSym} balance:`, ethers.formatUnits(tstBal, tstDec));

  // ---------- POOL #1: WBDAG/USDC ----------
  console.log("\n== Pool #1: WBDAG/USDC ==");
  let pair1 = await retry("factory.getPair(WBDAG,USDC)", async () => factory.getPair(WBDAG, USDC));
  if (pair1 === ethers.ZeroAddress) {
    console.log("pair missing -> creating via addLiquidityETH...");

    const amtUsdc = ethers.parseUnits(AMOUNTS.usdc, usdcDec);
    const amtEth = ethers.parseEther(AMOUNTS.wbdg);

    // approve (only if needed)
    const allowance = await retry("usdc.allowance()", async () => usdc.allowance(me, routerAddr));
    if (allowance < amtUsdc) {
      const txA = await retry("usdc.approve()", async () => usdc.approve(routerAddr, amtUsdc, { gasLimit: GAS.approve }));
      console.log("approve tx:", txA.hash);
      await retry("approve wait", async () => txA.wait());
      console.log("approve OK");
    } else {
      console.log("approve: already sufficient");
    }

    const txL = await retry("addLiquidityETH()", async () =>
      router.addLiquidityETH(
        USDC,
        amtUsdc,
        0,
        0,
        me,
        nowDeadline(),
        { value: amtEth, gasLimit: GAS.liq }
      )
    );
    console.log("addLiquidityETH tx:", txL.hash);
    await retry("addLiquidityETH wait", async () => txL.wait());
    console.log("addLiquidityETH OK");

    pair1 = await retry("factory.getPair(WBDAG,USDC) after", async () => factory.getPair(WBDAG, USDC));
  } else {
    console.log("pair already exists:", pair1);
  }

  if (pair1 === ethers.ZeroAddress) {
    throw new Error("Pool #1 still missing after addLiquidityETH. Router/factory mismatch or tx failed.");
  }

  await printPairInfo(ethers.provider, pair1);

  // ---------- POOL #2: TST/USDC (optional) ----------
  console.log("\n== Pool #2: TST/USDC (optional) ==");
  let pair2 = await retry("factory.getPair(TST,USDC)", async () => factory.getPair(TST, USDC));
  if (pair2 === ethers.ZeroAddress) {
    console.log("pair missing -> trying router.addLiquidity (if supported)...");

    const amtTst = ethers.parseUnits(AMOUNTS.tst, tstDec);
    const amtUsdc2 = ethers.parseUnits(AMOUNTS.usdc2, usdcDec);

    // approve both
    const [allowT, allowU] = await Promise.all([
      retry("tst.allowance()", async () => tst.allowance(me, routerAddr)),
      retry("usdc.allowance()", async () => usdc.allowance(me, routerAddr)),
    ]);

    if (allowT < amtTst) {
      const txAT = await retry("tst.approve()", async () => tst.approve(routerAddr, amtTst, { gasLimit: GAS.approve }));
      console.log("approve TST tx:", txAT.hash);
      await retry("approve TST wait", async () => txAT.wait());
      console.log("approve TST OK");
    } else {
      console.log("approve TST: already sufficient");
    }

    if (allowU < amtUsdc2) {
      const txAU = await retry("usdc.approve()", async () => usdc.approve(routerAddr, amtUsdc2, { gasLimit: GAS.approve }));
      console.log("approve USDC tx:", txAU.hash);
      await retry("approve USDC wait", async () => txAU.wait());
      console.log("approve USDC OK");
    } else {
      console.log("approve USDC: already sufficient");
    }

    // Try addLiquidity; if router doesn't have it, we catch and skip.
    try {
      const txL2 = await retry("addLiquidity()", async () =>
        router.addLiquidity(
          TST,
          USDC,
          amtTst,
          amtUsdc2,
          0,
          0,
          me,
          nowDeadline(),
          { gasLimit: GAS.liq }
        )
      );
      console.log("addLiquidity tx:", txL2.hash);
      await retry("addLiquidity wait", async () => txL2.wait());
      console.log("addLiquidity OK");

      pair2 = await retry("factory.getPair(TST,USDC) after", async () => factory.getPair(TST, USDC));
    } catch (e) {
      const msg = e?.shortMessage || e?.reason || e?.message || String(e);
      console.log("Router likely doesn't support addLiquidity(). Skipping Pool #2.");
      console.log("Reason:", msg);
      pair2 = ethers.ZeroAddress;
    }
  } else {
    console.log("pair already exists:", pair2);
  }

  if (pair2 !== ethers.ZeroAddress) {
    await printPairInfo(ethers.provider, pair2);
  } else {
    console.log("Pool #2 not created (router missing addLiquidity).");
  }

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error("ERROR:", e?.shortMessage || e?.reason || e?.message || e);
  process.exitCode = 1;
});
