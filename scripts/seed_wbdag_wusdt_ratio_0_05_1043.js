// scripts/seed_wbdag_wusdt_ratio_0_05_1043.js
//
// Seeds WBDAG/WUSDT at the target ratio:
//   1 BDAG = 0.05 WUSDT
//
// Default amounts keep the same "max 190 BDAG" constraint as the old WUSDC script:
//   190 BDAG and 9.5 WUSDT
//
// Run:
//   WUSDT=0x... npx hardhat run --network bdagTestnet scripts/seed_wbdag_wusdt_ratio_0_05_1043.js
//
// Optional ENV:
//   BDAG_AMOUNT=190
//   WUSDT_AMOUNT=9.5
//   ROUTER=0x...
//   FACTORY=0x...

const hre = require("hardhat");
const { ethers } = hre;
const path = require("path");
const { pathToFileURL } = require("url");

function mustAddr(name, v) {
  if (!v || !ethers.isAddress(v)) throw new Error(`Missing/invalid ${name}: ${v || ""}`);
  return v;
}

const DEFAULTS = {
  chainId: 1043,
  ROUTER: "0xe29D2A1F36c5D86929BE895A72FBFEED83841a1C",
  FACTORY: "0xa06F091b46da5e53D8d8F1D7519150E29d91e291",
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

const FACTORY_ABI = ["function getPair(address tokenA,address tokenB) external view returns (address)"];

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

async function resolveWusdtAddr() {
  const fromEnv = process.env.WUSDT || process.env.WUSDT_ADDR || "";
  if (fromEnv && ethers.isAddress(fromEnv)) return fromEnv;

  // Convenience fallback: if you added WUSDT to the UI token list, reuse it here.
  try {
    const tokenFile = path.join(__dirname, "..", "ui", "src", "lib", "tokens_1043.js");
    const mod = await import(pathToFileURL(tokenFile).href);
    const list = mod?.TOKENS_1043;
    if (Array.isArray(list)) {
      const t = list.find((x) => String(x?.symbol || "").toUpperCase() === "WUSDT");
      const addr = String(t?.address || "");
      if (ethers.isAddress(addr)) return addr;
    }
  } catch {}

  throw new Error(
    "Missing/invalid WUSDT: set env WUSDT=0x... (or add WUSDT with a valid address in ui/src/lib/tokens_1043.js)."
  );
}

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log("Network:", hre.network.name, "chainId:", Number(net.chainId));
  if (Number(net.chainId) !== DEFAULTS.chainId) console.log("WARNING: unexpected chainId");

  const ROUTER = mustAddr("ROUTER", process.env.ROUTER || DEFAULTS.ROUTER);
  const FACTORY = mustAddr("FACTORY", process.env.FACTORY || DEFAULTS.FACTORY);
  const WUSDT = mustAddr("WUSDT", await resolveWusdtAddr());

  const bdagHuman = process.env.BDAG_AMOUNT ? String(process.env.BDAG_AMOUNT) : "10";
  const wusdtHuman = process.env.WUSDT_AMOUNT ? String(process.env.WUSDT_AMOUNT) : "0.5"; // 190 * 0.05

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Signer:", me);
  console.log("Router:", ROUTER);
  console.log("Factory:", FACTORY);
  console.log("WUSDT:", WUSDT);
  console.log("Amounts:", bdagHuman, "BDAG +", wusdtHuman, "WUSDT");

  const router = await ethers.getContractAt(ROUTER_ABI, ROUTER, signer);
  const factory = await ethers.getContractAt(FACTORY_ABI, FACTORY, ethers.provider);

  const [rf, rw] = await Promise.all([router.factory(), router.WETH()]);
  console.log("router.factory():", rf);
  console.log("router.WETH():", rw);

  const usdt = await ethers.getContractAt(ERC20_ABI, WUSDT, signer);
  const [sym, dec] = await Promise.all([usdt.symbol().catch(() => "WUSDT"), usdt.decimals()]);
  console.log("Token:", sym, "decimals:", dec.toString());

  const amountTokenDesired = ethers.parseUnits(wusdtHuman, Number(dec));
  const amountETHDesired = ethers.parseEther(bdagHuman);

  const [balToken, balNative] = await Promise.all([usdt.balanceOf(me), ethers.provider.getBalance(me)]);
  console.log(`${sym} balance:`, ethers.formatUnits(balToken, Number(dec)));
  console.log("native BDAG balance:", ethers.formatEther(balNative));

  const beforePair = await factory.getPair(rw, WUSDT);
  console.log("pair before:", beforePair);

  const allowance = await usdt.allowance(me, ROUTER);
  if (allowance < amountTokenDesired) {
    const txA = await usdt.approve(ROUTER, amountTokenDesired, { gasLimit: GAS.APPROVE });
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
      token: WUSDT,
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

  const pair = await factory.getPair(rw, WUSDT);
  console.log("pair after:", pair);
  if (isZero(pair)) throw new Error("Pair still ZERO after addLiquidityETH");

  const pairC = await ethers.getContractAt(PAIR_ABI, pair, ethers.provider);
  const [t0, t1, r] = await Promise.all([pairC.token0(), pairC.token1(), pairC.getReserves()]);
  console.log("token0:", t0);
  console.log("token1:", t1);
  console.log("reserves:", r[0].toString(), "/", r[1].toString());

  console.log("DONE.");
}

main().catch((e) => {
  console.error("ERROR:", e?.shortMessage || e?.reason || e?.message || e);
  process.exitCode = 1;
});
