const hre = require("hardhat");

async function main() {
  const cfg = hre.network.config;
  console.log("NETWORK:", hre.network.name);
  console.log("RPC URL:", cfg.url);
  console.log("CHAINID (config):", cfg.chainId);

  const net = await hre.ethers.provider.getNetwork();
  console.log("CHAINID (provider):", net.chainId.toString());
}

main().catch((e) => { console.error(e); process.exit(1); });
