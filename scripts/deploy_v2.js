const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  const CHAIN_ID = Number(process.env.CHAIN_ID || 1043);
  const RPC_URL = process.env.RPC_URL || "https://rpc.awakening.bdagscan.com";
  const OFFICIAL_WBDAG = process.env.OFFICIAL_WBDAG || "0xC97B4e92fB267bB11b1CD2d475F9E8c16b433289";

  console.log("Deployer:", deployer.address);
  console.log("Using OFFICIAL WBDAG:", OFFICIAL_WBDAG);

  // 1) Deploy Factory
  const Factory = await hre.ethers.getContractFactory("UniswapV2Factory");
  // feeToSetter = deployer
  const factory = await Factory.deploy(deployer.address);
  await factory.waitForDeployment();

  const factoryAddr = await factory.getAddress();
  console.log("Factory:", factoryAddr);

  // 2) Deploy RouterLite (⚠️ solo factory nel constructor)
  const RouterLite = await hre.ethers.getContractFactory("V2RouterLite");
  const router = await RouterLite.deploy(factoryAddr);
  await router.waitForDeployment();

  const routerAddr = await router.getAddress();
  console.log("RouterLite:", routerAddr);

  console.log("\nCOPY THIS JSON:");
  console.log(
    JSON.stringify(
      {
        chainId: CHAIN_ID,
        rpc: RPC_URL,
        WBDAG: OFFICIAL_WBDAG,
        factory: factoryAddr,
        router: routerAddr,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
