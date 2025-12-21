// scripts/deploy_faucet_1043.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function writeJson(chainId, obj) {
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${chainId}.mockusdc.json`);
  fs.writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");
  return outPath;
}

async function main() {
  const { ethers, network } = hre;
  const provider = ethers.provider;

  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);

  if (chainId !== 1043) throw new Error(`Run this only on testnet 1043. Got ${chainId}`);

  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();

  console.log("========================================");
  console.log("DEPLOY MOCK USDC + FAUCET");
  console.log(`Network: ${network.name}`);
  console.log(`ChainId: ${chainId}`);
  console.log("========================================");
  console.log("Deployer:", me);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy({ gasLimit: 4_000_000 });
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockUSDC:", usdcAddr);

  // dripAmount = 1000 USDC (6 decimals => 1000 * 1e6)
  const dripAmount = 1000n * 1_000_000n;
  const cooldown = 30; // seconds

  const Faucet = await ethers.getContractFactory("TokenFaucet");
  const faucet = await Faucet.deploy(usdcAddr, dripAmount, cooldown, { gasLimit: 4_000_000 });
  await faucet.waitForDeployment();
  const faucetAddr = await faucet.getAddress();
  console.log("Faucet:", faucetAddr);

  const out = {
    network: network.name,
    chainId,
    deployer: me,
    mockUSDC: usdcAddr,
    faucet: faucetAddr,
    dripAmount: dripAmount.toString(),
    cooldownSeconds: cooldown,
    timestamp: new Date().toISOString(),
  };

  const outPath = writeJson(chainId, out);
  console.log("WRITTEN:", outPath);
  console.log(JSON.stringify(out, null, 2));

  console.log("========================================");
  console.log("NEXT:");
  console.log(`1) npx hardhat console --network ${network.name}`);
  console.log(`2) const f = await ethers.getContractAt(["function drip()"], "${faucetAddr}")`);
  console.log("3) await f.drip()");
  console.log("========================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
