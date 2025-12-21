const hre = require("hardhat");
require("dotenv").config();

function formatUnits(x, decimals) {
  const s = x.toString().padStart(decimals + 1, "0");
  const intPart = s.slice(0, -decimals);
  const fracPart = s.slice(-decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

async function safeDecimals(addr) {
  const p = hre.ethers.provider;
  try {
    const c8 = new hre.ethers.Contract(addr, ["function decimals() view returns (uint8)"], p);
    return Number(await c8.decimals());
  } catch (_) {}
  try {
    const c256 = new hre.ethers.Contract(addr, ["function decimals() view returns (uint256)"], p);
    return Number(await c256.decimals());
  } catch (_) {}
  return 18;
}

async function main() {
  const [me] = await hre.ethers.getSigners();

  // === tuoi address ===
  const FACTORY = "0x19EA6e4cFbb9b521471D626BCEef15B08439D700";
  const WBDAG   = "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289";

  // Se vuoi forzare un TT specifico, mettilo qui.
  // Altrimenti deploya un TestToken e incolla l'address.
  const TT = "0x5F4E227AB4EA0CB8462F37c11e164533a4d5951e";

  console.log("Me:", me.address);
  console.log("Factory:", FACTORY);
  console.log("WBDAG:", WBDAG);
  console.log("TT:", TT);

  const ERC20 = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address,uint256) returns (bool)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ];

  const FACTORY_ABI = [
    "function getPair(address,address) view returns (address)",
    "function createPair(address,address) returns (address)",
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
  ];

  // UniswapV2Pair ABI minimo per mint/reserves
  const PAIR_ABI = [
    "function mint(address to) returns (uint liquidity)",
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function balanceOf(address) view returns (uint256)",
  ];

  const factory = new hre.ethers.Contract(FACTORY, FACTORY_ABI, me);
  const wbdag   = new hre.ethers.Contract(WBDAG, ERC20, me);
  const tt      = new hre.ethers.Contract(TT, ERC20, me);

  const [wbDec, ttDec] = await Promise.all([safeDecimals(WBDAG), safeDecimals(TT)]);
  console.log("Decimals:", { WBDAG: wbDec, TT: ttDec });

  // 1) assicurati pair
  let pairAddr = await factory.getPair(WBDAG, TT);
  console.log("Pair(before):", pairAddr);

  if (pairAddr === "0x0000000000000000000000000000000000000000") {
    console.log("Creating pair...");
    const tx = await factory.createPair(WBDAG, TT);
    console.log("createPair tx:", tx.hash);
    const rc = await tx.wait();
    console.log("createPair status:", rc.status);

    pairAddr = await factory.getPair(WBDAG, TT);
    console.log("Pair(after):", pairAddr);

    // fallback parse logs
    if (pairAddr === "0x0000000000000000000000000000000000000000") {
      for (const log of rc.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === "PairCreated") pairAddr = parsed.args.pair;
        } catch (_) {}
      }
      console.log("Pair(after log parse):", pairAddr);
    }
  }

  if (pairAddr === "0x0000000000000000000000000000000000000000") {
    throw new Error("Pair ancora 0x0. Factory/RPC problema.");
  }

  const pair = new hre.ethers.Contract(pairAddr, PAIR_ABI, me);

  // 2) importi (puoi cambiarli)
  const amountWBDAG = hre.ethers.parseUnits("1.0", wbDec);     // 1 WBDAG
  const amountTT    = hre.ethers.parseUnits("1000", ttDec);    // 1000 TT

  // 3) check balances
  const [wbBal, ttBal] = await Promise.all([
    wbdag.balanceOf(me.address),
    tt.balanceOf(me.address),
  ]);

  console.log("Balances BEFORE:");
  console.log("  WBDAG:", formatUnits(wbBal, wbDec));
  console.log("  TT   :", formatUnits(ttBal, ttDec));

  if (wbBal < amountWBDAG) throw new Error("Non hai abbastanza WBDAG.");
  if (ttBal < amountTT) throw new Error("Non hai abbastanza TT.");

  // 4) trasferisci al pair (manual liquidity)
  console.log("Transferring tokens to pair...");
  const tx1 = await wbdag.transfer(pairAddr, amountWBDAG);
  console.log("WBDAG transfer tx:", tx1.hash);
  await tx1.wait();

  const tx2 = await tt.transfer(pairAddr, amountTT);
  console.log("TT transfer tx:", tx2.hash);
  await tx2.wait();

  console.log("✅ Tokens transferred to pair.");

  // 5) mint LP
  console.log("Minting LP...");
  const txMint = await pair.mint(me.address);
  console.log("mint tx:", txMint.hash);
  const rcMint = await txMint.wait();
  console.log("mint status:", rcMint.status);

  // 6) reserves
  const [r0, r1] = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  console.log("Pair:", pairAddr);
  console.log("token0:", token0);
  console.log("token1:", token1);
  console.log("Reserves raw:", r0.toString(), r1.toString());

  // Stampa “umano” assoc.
  if (token0.toLowerCase() === WBDAG.toLowerCase()) {
    console.log("Reserves:");
    console.log("  WBDAG:", formatUnits(r0, wbDec));
    console.log("  TT   :", formatUnits(r1, ttDec));
  } else {
    console.log("Reserves:");
    console.log("  TT   :", formatUnits(r0, ttDec));
    console.log("  WBDAG:", formatUnits(r1, wbDec));
  }

  const lpBal = await pair.balanceOf(me.address);
  console.log("LP balance:", lpBal.toString(), "(raw)");
  console.log("✅ Manual addLiquidity DONE.");
}

main().catch((e) => {
  console.error("SCRIPT FAILED:", e?.shortMessage || e?.message || e);
  process.exitCode = 1;
});
