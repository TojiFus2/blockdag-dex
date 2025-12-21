const hre = require("hardhat");
require("dotenv").config();

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function codeLen(addr) {
  const code = await hre.ethers.provider.getCode(addr);
  return (code?.length || 0) - 2; // "0x" => 0
}

async function waitForCode(addr, minLen = 10, attempts = 25, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    const len = await codeLen(addr);
    if (len >= minLen) return len;
    await sleep(delayMs);
  }
  return await codeLen(addr);
}

async function safeDecimals(addr) {
  try {
    const c8 = new hre.ethers.Contract(
      addr,
      ["function decimals() view returns (uint8)"],
      hre.ethers.provider
    );
    return Number(await c8.decimals());
  } catch (_) {}
  try {
    const c256 = new hre.ethers.Contract(
      addr,
      ["function decimals() view returns (uint256)"],
      hre.ethers.provider
    );
    return Number(await c256.decimals());
  } catch (_) {}
  return 18;
}

function parseUnits(valueStr, decimals) {
  const [a, b = ""] = valueStr.split(".");
  const frac = (b + "0".repeat(decimals)).slice(0, decimals);
  const s = (a || "0") + frac;
  return BigInt(s.replace(/^0+(?=\d)/, ""));
}

function formatUnits(x, decimals) {
  const s = x.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals);
  const fracPart = s.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

async function main() {
  const [me] = await hre.ethers.getSigners();

  // === i tuoi address ===
  const FACTORY = "0x19EA6e4cFbb9b521471D626BCEef15B08439D700";
  const ROUTER  = "0x9C405a0027Fc377CB70db276c158b447984fED92";
  const WBDAG   = "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289"; // official

  console.log("Me:", me.address);
  console.log("Factory:", FACTORY);
  console.log("RouterLite:", ROUTER);
  console.log("WBDAG:", WBDAG);

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ];

  const FACTORY_ABI = [
    "function getPair(address,address) view returns (address)",
    "function createPair(address,address) returns (address)",
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
  ];

  const ROUTER_ABI = [
    "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB,uint liquidity)",
    "function swapExactTokensForTokens(uint amountIn,uint amountOutMin,address[] calldata path,address to,uint deadline) returns (uint[] memory amounts)",
  ];

  const factory = new hre.ethers.Contract(FACTORY, FACTORY_ABI, me);
  const router  = new hre.ethers.Contract(ROUTER, ROUTER_ABI, me);

  // 1) Deploy TestToken con supply iniziale al deployer
  const TestTokenFactory = await hre.ethers.getContractFactory("TestToken");

  const initialSupply = hre.ethers.parseUnits("1000000", 18); // 1,000,000 TT
  const deployTx = await TestTokenFactory.getDeployTransaction("Test Token", "TT", initialSupply);

  // Stampiamo il deploy calldata size (debug utile su chain “strane”)
  console.log("Deploy TestToken tx data len:", (deployTx.data?.length || 0) - 2);

  const testToken = await TestTokenFactory.deploy("Test Token", "TT", initialSupply);

  const depTx = testToken.deploymentTransaction();
  if (!depTx) throw new Error("deploymentTransaction() null (deploy non partito)");

  console.log("TestToken deploy tx:", depTx.hash);

  const receipt = await depTx.wait();
  console.log("TestToken deploy mined. status:", receipt.status, "block:", receipt.blockNumber);

  const TT = await testToken.getAddress();
  console.log("TestToken:", TT);

  // 2) Code checks (con retry, perché alcuni RPC laggano sul getCode)
  const wbCode = await waitForCode(WBDAG, 10, 15, 1000);
  const ttCode = await waitForCode(TT, 10, 25, 1500);

  console.log("CodeLen WBDAG:", wbCode);
  console.log("CodeLen TT   :", ttCode);

  if (wbCode <= 0) throw new Error("WBDAG codeLen=0 (address sbagliato o RPC bug)");
  if (ttCode <= 0) {
    throw new Error(
      "TT codeLen=0 (deploy non valido O RPC non sta servendo il bytecode). " +
      "Guarda receipt.status sopra: se status=0 è revert; se status=1 è RPC lag."
    );
  }

  // 3) Decimals
  const [wbDec, ttDec] = await Promise.all([safeDecimals(WBDAG), safeDecimals(TT)]);
  console.log("Decimals:", { WBDAG: wbDec, TT: ttDec });

  const wbdag = new hre.ethers.Contract(WBDAG, ERC20_ABI, me);
  const tt    = new hre.ethers.Contract(TT, ERC20_ABI, me);

  // 4) Balances
  const [wbBal, ttBal] = await Promise.all([
    wbdag.balanceOf(me.address),
    tt.balanceOf(me.address),
  ]);

  console.log("Balances BEFORE:");
  console.log("  WBDAG:", formatUnits(BigInt(wbBal.toString()), wbDec));
  console.log("  TT   :", formatUnits(BigInt(ttBal.toString()), ttDec));

  // 5) Ensure pair exists
  let pair = await factory.getPair(WBDAG, TT);
  console.log("Pair (before):", pair);

  if (pair === "0x0000000000000000000000000000000000000000") {
    console.log("Creating pair...");
    const tx = await factory.createPair(WBDAG, TT);
    console.log("createPair tx:", tx.hash);
    const rc = await tx.wait();
    console.log("createPair mined status:", rc.status);

    // getPair può laggare su alcuni RPC: aspetta un attimo e riprova
    await sleep(1200);
    pair = await factory.getPair(WBDAG, TT);
    console.log("Pair (after):", pair);

    // fallback: se ancora 0x0, prova a leggere l’evento
    if (pair === "0x0000000000000000000000000000000000000000") {
      for (const log of rc.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === "PairCreated") {
            console.log("PairCreated event:", parsed.args.pair);
            pair = parsed.args.pair;
          }
        } catch (_) {}
      }
      console.log("Pair (after event parse):", pair);
    }
  }

  if (pair === "0x0000000000000000000000000000000000000000") {
    throw new Error("Pair ancora 0x0 dopo createPair (factory/RPC problema)");
  }

  // 6) Approvals
  const amountWBDAG = parseUnits("1.0", wbDec);        // 1 WBDAG
  const amountTT    = parseUnits("1000", ttDec);       // 1000 TT

  if (BigInt(wbBal.toString()) < amountWBDAG) {
    throw new Error("Non hai abbastanza WBDAG per aggiungere liquidità (riduci amountWBDAG).");
  }
  if (BigInt(ttBal.toString()) < amountTT) {
    throw new Error("Non hai abbastanza TT per aggiungere liquidità (deploy TT non ha mintato come previsto).");
  }

  const allowW = await wbdag.allowance(me.address, ROUTER);
  if (BigInt(allowW.toString()) < amountWBDAG) {
    const tx = await wbdag.approve(ROUTER, hre.ethers.MaxUint256);
    console.log("Approve WBDAG tx:", tx.hash);
    await tx.wait();
    console.log("Approved WBDAG ✅");
  } else {
    console.log("WBDAG allowance OK ✅");
  }

  const allowT = await tt.allowance(me.address, ROUTER);
  if (BigInt(allowT.toString()) < amountTT) {
    const tx = await tt.approve(ROUTER, hre.ethers.MaxUint256);
    console.log("Approve TT tx:", tx.hash);
    await tx.wait();
    console.log("Approved TT ✅");
  } else {
    console.log("TT allowance OK ✅");
  }

  // 7) addLiquidity
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const minW = 0n;
  const minT = 0n;

  console.log("Adding liquidity...");
  console.log("  amountWBDAG:", amountWBDAG.toString());
  console.log("  amountTT   :", amountTT.toString());

  await router.addLiquidity.staticCall(
    WBDAG, TT,
    amountWBDAG, amountTT,
    minW, minT,
    me.address,
    deadline
  );
  console.log("✅ addLiquidity.staticCall OK");

  const txAdd = await router.addLiquidity(
    WBDAG, TT,
    amountWBDAG, amountTT,
    minW, minT,
    me.address,
    deadline
  );
  console.log("addLiquidity tx:", txAdd.hash);
  const rcAdd = await txAdd.wait();
  console.log("addLiquidity mined ✅ status:", rcAdd.status);

  // 8) Swap test (WBDAG -> TT)
  const amountIn = parseUnits("0.1", wbDec);
  const path = [WBDAG, TT];
  const minOut = 0n;

  console.log("Swapping WBDAG -> TT...");

  await router.swapExactTokensForTokens.staticCall(
    amountIn,
    minOut,
    path,
    me.address,
    deadline
  );
  console.log("✅ swap.staticCall OK");

  const txSwap = await router.swapExactTokensForTokens(
    amountIn,
    minOut,
    path,
    me.address,
    deadline
  );
  console.log("swap tx:", txSwap.hash);
  const rcSwap = await txSwap.wait();
  console.log("swap mined ✅ status:", rcSwap.status);

  const [wbAfter, ttAfter] = await Promise.all([
    wbdag.balanceOf(me.address),
    tt.balanceOf(me.address),
  ]);

  console.log("Balances AFTER:");
  console.log("  WBDAG:", formatUnits(BigInt(wbAfter.toString()), wbDec));
  console.log("  TT   :", formatUnits(BigInt(ttAfter.toString()), ttDec));
}

main().catch((e) => {
  console.error("SCRIPT FAILED:", e?.shortMessage || e?.message || e);
  process.exitCode = 1;
});
