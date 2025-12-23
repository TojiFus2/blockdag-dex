// scripts/seed_wbdag_wusdc_ratio_100_1043.js
//
// Seeds WBDAG/WUSDC at a sane ratio for testnet:
//   1 BDAG = 100 WUSDC
//
// With your constraint: max 190 BDAG
// => use 190 BDAG and 19000 WUSDC
//
// Run:
//   npx hardhat run --network bdagTestnet scripts/seed_wbdag_wusdc_ratio_100_1043.js

const hre = require("hardhat");
const { ethers } = hre;

const CFG = {
  chainId: 1043,
  ROUTER: "0xe29D2A1F36c5D86929BE895A72FBFEED83841a1C",
  FACTORY: "0xa06F091b46da5e53D8d8F1D7519150E29d91e291",
  WUSDC: "0xd7eFc4e37306b379C88DBf8749189C480bfEA340",
};

const AMOUNTS = {
  bdg: "190",     // native BDAG to deposit
  wusdc: "19000", // 190 * 100
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

async function main() {
  const net = await ethers.provider.getNetwork();
  console.log("Network:", hre.network.name, "chainId:", Number(net.chainId));
  if (Number(net.chainId) !== CFG.chainId) console.log("WARNING: unexpected chainId");

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Signer:", me);

  const router = await ethers.getContractAt(ROUTER_ABI, CFG.ROUTER, signer);
  const factory = await ethers.getContractAt(FACTORY_ABI, CFG.FACTORY, ethers.provider);

  const [rf, rw] = await Promise.all([router.factory(), router.WETH()]);
  console.log("router.factory():", rf);
  console.log("router.WETH():", rw);

  const usdc = await ethers.getContractAt(ERC20_ABI, CFG.WUSDC, signer);
  const [sym, dec] = await Promise.all([usdc.symbol().catch(() => "WUSDC"), usdc.decimals()]);
  console.log("Token:", sym, "decimals:", dec.toString());

  const amountTokenDesired = ethers.parseUnits(AMOUNTS.wusdc, Number(dec));
  const amountETHDesired = ethers.parseEther(AMOUNTS.bdg);

  const balUsdc = await usdc.balanceOf(me);
  const balNative = await ethers.provider.getBalance(me);
  console.log(`${sym} balance:`, ethers.formatUnits(balUsdc, Number(dec)));
  console.log("native BDAG balance:", ethers.formatEther(balNative));

  const beforePair = await factory.getPair(rw, CFG.WUSDC);
  console.log("pair before:", beforePair);

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
      token: CFG.WUSDC,
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

  const pair = await factory.getPair(rw, CFG.WUSDC);
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
