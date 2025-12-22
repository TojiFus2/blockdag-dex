// scripts/deploy_mockusdcv2_1043.js
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 1043) throw new Error(`Run on chainId 1043 only. Got ${chainId}`);

  const [deployer] = await ethers.getSigners();
  console.log("========================================");
  console.log("Deploy MockUSDCv2 — TESTNET 1043");
  console.log("Network:", network.name);
  console.log("ChainId:", chainId);
  console.log("Deployer (new owner):", deployer.address);
  console.log("========================================");

  const MockUSDCv2 = await ethers.getContractFactory("MockUSDCv2");
  const token = await MockUSDCv2.deploy({ gasLimit: 3_000_000 });
  await token.waitForDeployment();

  const addr = await token.getAddress();
  console.log("MockUSDCv2 deployed at:", addr);

  // sanity: owner()
  const owner = await token.owner();
  console.log("owner():", owner);

  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
