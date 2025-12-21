const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const provider = hre.ethers.provider;

  // incolla qui l'hash del transfer TT che avevi stampato
  const TX_HASH = "0x041888619be80bdeacf035b615b68b690db2d988adaa090a1675195898692628";

  const receipt = await provider.getTransactionReceipt(TX_HASH);
  if (!receipt) throw new Error("Receipt null (tx non trovata?)");

  console.log("tx:", TX_HASH);
  console.log("status:", receipt.status);
  console.log("logs:", receipt.logs.length);

  // ERC20 Transfer event topic
  const TRANSFER_TOPIC = hre.ethers.id("Transfer(address,address,uint256)");

  for (const log of receipt.logs) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue;

    const from = hre.ethers.getAddress("0x" + log.topics[1].slice(26));
    const to   = hre.ethers.getAddress("0x" + log.topics[2].slice(26));
    const value = hre.ethers.toBigInt(log.data);

    console.log("Transfer @", log.address);
    console.log("  from:", from);
    console.log("  to  :", to);
    console.log("  val :", value.toString());
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.shortMessage || e?.message || e);
  process.exitCode = 1;
});
