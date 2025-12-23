// scripts/remove_liquidity_pair_burn_wbdag_usdc_1043.js
//
// Remove liquidity WITHOUT router (your router has no removeLiquidity).
// Uses UniswapV2Pair burn flow:
//   1) transfer LP tokens to pair
//   2) pair.burn(to) -> returns token0/token1 amounts
//   3) if token0 or token1 is WBDAG, optionally unwrap to native BDAG
//
// Run:
//   npx hardhat run --network bdagTestnet scripts/remove_liquidity_pair_burn_wbdag_usdc_1043.js

const hre = require("hardhat");
const { ethers } = hre;

const CFG = {
  CHAIN_ID: 1043,
  FACTORY: "0xa06F091b46da5e53D8d8F1D7519150E29d91e291",
  ROUTER: "0xe29D2A1F36c5D86929BE895A72FBFEED83841a1C",
  WBDAG: "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289",
  WUSDC: "0xd7eFc4e37306b379C88DBf8749189C480bfEA340",
  UNWRAP_WBDAG_TO_NATIVE: true,
};

const FACTORY_ABI = ["function getPair(address,address) view returns(address)"];

const PAIR_ABI = [
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function getReserves() view returns(uint112,uint112,uint32)",
  "function balanceOf(address) view returns(uint256)", // LP token (pair is ERC20)
  "function transfer(address to, uint256 value) returns(bool)", // LP token transfer
  "function burn(address to) returns (uint256 amount0, uint256 amount1)", // UniswapV2Pair burn
];

const ERC20_ABI = [
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
];

const WETH_ABI = ["function withdraw(uint256) external"];

function isZero(a) {
  return !a || a.toLowerCase() === ethers.ZeroAddress.toLowerCase();
}

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  console.log("Network:", hre.network.name);
  console.log("ChainId:", chainId);
  if (chainId !== CFG.CHAIN_ID) console.log("WARNING: unexpected chainId");

  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  console.log("Signer:", me);

  const factory = await ethers.getContractAt(FACTORY_ABI, CFG.FACTORY, ethers.provider);
  const pairAddr = await factory.getPair(CFG.WBDAG, CFG.WUSDC);
  console.log("Pair:", pairAddr);
  if (isZero(pairAddr)) throw new Error("Pair not found");

  const pair = await ethers.getContractAt(PAIR_ABI, pairAddr, signer);

  const [t0, t1, rs] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  console.log("token0:", t0);
  console.log("token1:", t1);
  console.log("reserves:", rs[0].toString(), "/", rs[1].toString());

  const lpBal = await pair.balanceOf(me);
  console.log("LP balance:", lpBal.toString());
  if (lpBal === 0n) throw new Error("No LP tokens on signer");

  console.log("Transferring LP tokens to pair...");
  const txT = await pair.transfer(pairAddr, lpBal, { gasLimit: 600000 });
  console.log("LP transfer tx:", txT.hash);
  await txT.wait();

  console.log("Calling burn(me)...");
  const txB = await pair.burn(me, { gasLimit: 2000000 });
  console.log("burn tx:", txB.hash);
  const rc = await txB.wait();
  console.log("burn status:", rc.status);

  // After burn, balances are in wallet as ERC20s.
  const tok0 = await ethers.getContractAt(ERC20_ABI, t0, ethers.provider);
  const tok1 = await ethers.getContractAt(ERC20_ABI, t1, ethers.provider);

  const [sym0, dec0, sym1, dec1] = await Promise.all([
    tok0.symbol().catch(() => "T0"),
    tok0.decimals().catch(() => 18),
    tok1.symbol().catch(() => "T1"),
    tok1.decimals().catch(() => 18),
  ]);

  const [b0, b1] = await Promise.all([tok0.balanceOf(me), tok1.balanceOf(me)]);
  console.log(`${sym0} balance:`, ethers.formatUnits(b0, Number(dec0)));
  console.log(`${sym1} balance:`, ethers.formatUnits(b1, Number(dec1)));

  // Optionally unwrap WBDAG -> native
  if (CFG.UNWRAP_WBDAG_TO_NATIVE) {
    const wbdagAddr = CFG.WBDAG.toLowerCase();
    let wBal = 0n;
    if (t0.toLowerCase() === wbdagAddr) wBal = b0;
    if (t1.toLowerCase() === wbdagAddr) wBal = b1;

    if (wBal > 0n) {
      console.log("Unwrapping WBDAG to native BDAG:", ethers.formatEther(wBal));
      const w = await ethers.getContractAt(WETH_ABI, CFG.WBDAG, signer);
      const txW = await w.withdraw(wBal, { gasLimit: 600000 });
      console.log("withdraw tx:", txW.hash);
      await txW.wait();
      const nativeBal = await ethers.provider.getBalance(me);
      console.log("native BDAG balance:", ethers.formatEther(nativeBal));
    } else {
      console.log("No WBDAG to unwrap.");
    }
  }

  console.log("DONE.");
}

main().catch((e) => {
  console.error("ERROR:", e?.shortMessage || e?.reason || e?.message || e);
  process.exitCode = 1;
});
