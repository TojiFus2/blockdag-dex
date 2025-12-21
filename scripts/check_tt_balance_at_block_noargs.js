// scripts/check_tt_balance_at_block_noargs.js
// No CLI args (Hardhat on Windows is blocking them). Just run:
// npx hardhat run --network bdagTestnet .\scripts\check_tt_balance_at_block_noargs.js

const hre = require("hardhat");

async function main() {
  const TX_HASH = "0x041888619be80bdeacf035b615b68b690db2d988adaa090a1675195898692628";
  const TT      = "0x5F4E227AB4EA0CB8462F37c11e164533a4d5951e";
  const PAIR    = "0x2Abf1251fc922951e5FFE56CaAF190329457c32a";

  const provider = hre.ethers.provider;

  const erc20 = new hre.ethers.Contract(
    TT,
    [
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
    ],
    provider
  );

  const receipt = await provider.getTransactionReceipt(TX_HASH);
  if (!receipt) throw new Error("Receipt not found for tx " + TX_HASH);

  const block = receipt.blockNumber;

  let dec = 18, sym = "TT";
  try { dec = await erc20.decimals(); } catch {}
  try { sym = await erc20.symbol(); } catch {}

  const balNow = await erc20.balanceOf(PAIR);
  const balAt  = await erc20.balanceOf(PAIR, { blockTag: block });

  console.log("=== TT balance sanity (NOW vs AT TRANSFER BLOCK) ===");
  console.log("TX:   ", TX_HASH);
  console.log("BLOCK:", block);
  console.log("TT:   ", TT);
  console.log("PAIR: ", PAIR);
  console.log("sym/dec:", sym, dec);

  console.log("\nNOW raw:", balNow.toString());
  console.log("NOW fmt:", hre.ethers.formatUnits(balNow, dec));

  console.log("\nAT  raw:", balAt.toString());
  console.log("AT  fmt:", hre.ethers.formatUnits(balAt, dec));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
