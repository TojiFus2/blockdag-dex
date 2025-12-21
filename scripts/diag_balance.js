const hre = require("hardhat");

async function main() {
  const [s] = await hre.ethers.getSigners();
  const p = hre.ethers.provider;

  const net = await p.getNetwork();
  const bal = await p.getBalance(s.address);
  const nonceLatest = await p.getTransactionCount(s.address, "latest");
  const noncePending = await p.getTransactionCount(s.address, "pending");

  console.log("RPC URL (from hardhat config) -> check hardhat.config.js");
  console.log("signer:", s.address);
  console.log("chainId:", net.chainId.toString());
  console.log("balance raw:", bal.toString());
  console.log("balance ETH-format:", hre.ethers.formatEther(bal));
  console.log("nonce latest :", nonceLatest);
  console.log("nonce pending:", noncePending);
}

main().catch((e) => { console.error(e); process.exit(1); });
