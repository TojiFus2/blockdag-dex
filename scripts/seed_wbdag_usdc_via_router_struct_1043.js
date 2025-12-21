/* scripts/seed_wbdag_usdc_via_router_struct_1043.js
 *
 * Correct call for V2RouterLite2.addLiquidityETH(AddLiquidityETHParams)
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
  WBDAG: "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289",
  USDC:  "0x947eE27e29A0c95b0Ab4D8F494dC99AC3e8F2BA2", // MockUSDCv2 (6 dec)
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

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log("Network chainId:", Number(net.chainId));
  if (Number(net.chainId) !== CFG.chainId) console.log("WARNING: unexpected chainId");

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Deployer:", me);

  const router = new ethers.Contract(CFG.ROUTER, ROUTER_ABI, signer);
  const factory = new ethers.Contract(CFG.FACTORY, FACTORY_ABI, ethers.provider);
  const usdc = new ethers.Contract(CFG.USDC, ERC20_ABI, signer);

  const [rf, rw] = await Promise.all([router.factory(), router.WETH()]);
  console.log("router.factory():", rf);
  console.log("router.WETH():", rw);

  // Sanity: ensure we're using the real WBDAG from router
  const WBDAG = rw;
  const USDC = CFG.USDC;

  const [sym, dec] = await Promise.all([
    usdc.symbol().catch(() => "USDC"),
    usdc.decimals(),
  ]);

  const balUsdc = await usdc.balanceOf(me);
  const balNative = await ethers.provider.getBalance(me);
  console.log(`${sym} decimals:`, dec.toString());
  console.log(`${sym} balance:`, ethers.formatUnits(balUsdc, Number(dec)));
  console.log("native balance:", ethers.formatEther(balNative));

  const amountTokenDesired = ethers.parseUnits(AMOUNTS.usdc, Number(dec));
  const amountETHDesired = ethers.parseEther(AMOUNTS.eth);

  // Check pair before
  const beforePair = await factory.getPair(WBDAG, USDC);
  console.log("pair before:", beforePair);

  // Approve if needed
  const allowance = await usdc.allowance(me, CFG.ROUTER);
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
      token: USDC,
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

  const pair = await factory.getPair(WBDAG, USDC);
  console.log("pair after:", pair);
  if (isZero(pair)) throw new Error("Pair still ZERO after addLiquidityETH. Something else is wrong.");

  const pairC = new ethers.Contract(pair, PAIR_ABI, ethers.provider);
  const [t0, t1, r] = await Promise.all([pairC.token0(), pairC.token1(), pairC.getReserves()]);
  console.log("token0:", t0);
  console.log("token1:", t1);
  console.log("reserves:", r.reserve0.toString(), "/", r.reserve1.toString());

  console.log("\nDONE.");
}

main().catch((e) => {
  console.error("ERROR:", e?.shortMessage || e?.reason || e?.message || e);
  process.exitCode = 1;
});
