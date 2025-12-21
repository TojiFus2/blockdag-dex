// scripts/deploy_mockusdcv2_faucet_1043.js
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function writeJson(chainId, obj) {
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${chainId}.mockusdcv2.faucet.json`);
  fs.writeFileSync(outPath, JSON.stringify(obj, null, 2), "utf-8");
  return outPath;
}

async function main() {
  const { ethers, network } = hre;
  const provider = ethers.provider;

  const net = await provider.getNetwork();
  const chainId = Number(net.chainId);
  if (chainId !== 1043) throw new Error(`Run this only on chainId 1043. Got ${chainId}`);

  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();

  console.log("========================================");
  console.log("DEPLOY MockUSDCv2 + Faucet (ownership -> faucet)");
  console.log(`Network: ${network.name}`);
  console.log(`ChainId: ${chainId}`);
  console.log("========================================");
  console.log("Deployer:", me);

  // 1) Deploy MockUSDCv2
  const MockUSDCv2 = await ethers.getContractFactory("MockUSDCv2");
  const usdc = await MockUSDCv2.deploy({ gasLimit: 4_000_000 });
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log("MockUSDCv2:", usdcAddr);

  // 2) Deploy Faucet
  const dripAmount = 1000n * 1_000_000n; // 1000 USDC (6 decimals)
  const cooldown = 30;

  const Faucet = await ethers.getContractFactory("TokenFaucet");
  const faucet = await Faucet.deploy(usdcAddr, dripAmount, cooldown, { gasLimit: 4_000_000 });
  await faucet.waitForDeployment();
  const faucetAddr = await faucet.getAddress();
  console.log("Faucet:", faucetAddr);

  // 3) Transfer token ownership to faucet so it can mint
  console.log("Transferring MockUSDCv2 ownership -> Faucet ...");
  const tx = await usdc.transferOwnership(faucetAddr, { gasLimit: 300_000 });
  console.log(" - tx:", tx.hash);
  const rc = await tx.wait();
  console.log(" - status:", rc.status);

  const out = {
    network: network.name,
    chainId,
    deployer: me,
    mockUSDCv2: usdcAddr,
    faucet: faucetAddr,
    dripAmount: dripAmount.toString(),
    cooldownSeconds: cooldown,
    timestamp: new Date().toISOString(),
  };

  const outPath = writeJson(chainId, out);
  console.log("WRITTEN:", outPath);
  console.log(JSON.stringify(out, null, 2));

  console.log("========================================");
  console.log("NEXT: drip");
  console.log(`npx hardhat console --network ${network.name}`);
  console.log(`const f = await ethers.getContractAt(["function drip()"], "${faucetAddr}")`);
  console.log(`const tx2 = await f.drip({ gasLimit: 500000 }); tx2.hash`);
  console.log("========================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
