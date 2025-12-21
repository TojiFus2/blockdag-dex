// scripts/e2e_stack.js
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function loadDeployments(chainId) {
  const p = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(p)) throw new Error(`deployments not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function nowPlus(seconds) {
  return Math.floor(Date.now() / 1000) + seconds;
}

function requireAddress(name, value) {
  if (!value || typeof value !== "string") {
    throw new Error(`${name} is missing in deployments (got: ${value})`);
  }
  if (!value.startsWith("0x") || value.length !== 42) {
    throw new Error(`${name} looks invalid: ${value}`);
  }
  return value;
}

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  console.log("ChainId:", chainId);

  const dep = loadDeployments(chainId);

  const factoryAddr = requireAddress("factory", dep.factory);
  const routerAddr = requireAddress("router", dep.router);

  // ✅ accept all possible keys written by deploy_stack.js versions
  const wrappedAddr = dep.wrappedNative ?? dep.wrapped ?? dep.weth;
  const wrappedFinal = requireAddress("wrapped (wrappedNative|wrapped|weth)", wrappedAddr);

  console.log("Factory:", factoryAddr);
  console.log("Router:", routerAddr);
  console.log("Wrapped:", wrappedFinal);

  // Attach router
  const Router = await ethers.getContractFactory("V2RouterLite2");
  const router = Router.attach(routerAddr);

  // Deploy mintable test token
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy("Test Token", "TST", 18);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("TST:", tokenAddr);

  // Mint TST to deployer
  const mintTx = await token.mint(deployer.address, ethers.parseUnits("1000000", 18));
  await mintTx.wait();
  console.log("Minted 1,000,000 TST");

  // Approve router
  const approveTx = await token.approve(routerAddr, ethers.MaxUint256);
  await approveTx.wait();
  console.log("Approved router for TST");

  // Add liquidity via addLiquidityETH(struct)
  const ethToAdd = ethers.parseEther("5");
  const tokenToAdd = ethers.parseUnits("500000", 18);

  console.log("Adding liquidity (router.addLiquidityETH struct) ...");
  const addTx = await router.addLiquidityETH(
    {
      token: tokenAddr,
      amountTokenDesired: tokenToAdd,
      amountTokenMin: 0,
      amountETHMin: 0,
      to: deployer.address,
      deadline: nowPlus(3600),
    },
    { value: ethToAdd }
  );
  const addRcpt = await addTx.wait();
  console.log("addLiquidityETH status:", addRcpt.status, "gasUsed:", addRcpt.gasUsed.toString());

  // 1) swapExactETHForTokens (WETH -> TST)
  console.log("Swap ETH -> TST ...");
  const swapEthIn = ethers.parseEther("0.2");
  const swap1Tx = await router.swapExactETHForTokens(
    0,
    [wrappedFinal, tokenAddr],
    deployer.address,
    nowPlus(3600),
    { value: swapEthIn }
  );
  const swap1Rcpt = await swap1Tx.wait();
  console.log("swapExactETHForTokens status:", swap1Rcpt.status, "gasUsed:", swap1Rcpt.gasUsed.toString());

  // 2) swapExactTokensForETH (TST -> ETH)
  console.log("Swap TST -> ETH ...");
  const swapTokenIn = ethers.parseUnits("1000", 18);
  const swap2Tx = await router.swapExactTokensForETH(
    swapTokenIn,
    0,
    [tokenAddr, wrappedFinal],
    deployer.address,
    nowPlus(3600)
  );
  const swap2Rcpt = await swap2Tx.wait();
  console.log("swapExactTokensForETH status:", swap2Rcpt.status, "gasUsed:", swap2Rcpt.gasUsed.toString());

  const balTst = await token.balanceOf(deployer.address);
  const balEth = await ethers.provider.getBalance(deployer.address);
  console.log("Final balances:");
  console.log("TST:", ethers.formatUnits(balTst, 18));
  console.log("ETH:", ethers.formatEther(balEth));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
