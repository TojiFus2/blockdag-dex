const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Token = await hre.ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Test Token", "TST", 18);
  await token.waitForDeployment();

  const tokenAddr = await token.getAddress();
  console.log("Mock token:", tokenAddr);

  // Mint 1,000,000 TST to deployer
  const amount = hre.ethers.parseUnits("1000000", 18);
  const tx = await token.mint(deployer.address, amount);
  await tx.wait();
  console.log("Minted:", amount.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
