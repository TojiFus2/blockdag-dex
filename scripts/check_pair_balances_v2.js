const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const FACTORY = "0x19EA6e4cFbb9b521471D626BCEef15B08439D700";
  const WBDAG   = "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289";
  const TT      = "0x5F4E227AB4EA0CB8462F37c11e164533a4d5951e";

  const [me] = await hre.ethers.getSigners();
  console.log("Me:", me.address);

  const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];
  const PAIR_ABI = [
    "function getReserves() view returns (uint112,uint112,uint32)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
  ];

  const factory = new hre.ethers.Contract(FACTORY, FACTORY_ABI, me);
  const pairAddr = await factory.getPair(WBDAG, TT);
  console.log("Pair:", pairAddr);

  const pair = new hre.ethers.Contract(pairAddr, PAIR_ABI, me);
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  console.log("token0:", token0);
  console.log("token1:", token1);

  const t0 = new hre.ethers.Contract(token0, ERC20_ABI, me);
  const t1 = new hre.ethers.Contract(token1, ERC20_ABI, me);

  const [sym0, dec0, sym1, dec1] = await Promise.all([
    t0.symbol(), t0.decimals(),
    t1.symbol(), t1.decimals(),
  ]);

  const [bal0, bal1] = await Promise.all([
    t0.balanceOf(pairAddr),
    t1.balanceOf(pairAddr),
  ]);

  console.log(`Pair balance token0 (${sym0}):`, hre.ethers.formatUnits(bal0, dec0));
  console.log(`Pair balance token1 (${sym1}):`, hre.ethers.formatUnits(bal1, dec1));

  const [r0, r1] = await pair.getReserves();
  console.log("getReserves raw:", r0.toString(), r1.toString());
}

main().catch((e) => {
  console.error("FAILED:", e?.shortMessage || e?.message || e);
  process.exitCode = 1;
});
