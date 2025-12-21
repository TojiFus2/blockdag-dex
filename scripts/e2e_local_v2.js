const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function loadDeployments(chainId) {
  const p = path.join(__dirname, "..", "deployments", `${chainId}.json`);
  if (!fs.existsSync(p)) throw new Error(`Missing deployments file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  console.log("Deployer:", deployer.address);
  console.log("ChainId:", chainId);

  const dep = loadDeployments(chainId);
  const FACTORY = dep.factory;
  const ROUTER = dep.router;
  const WETH = dep.WETH;

  console.log("Factory :", FACTORY);
  console.log("Router  :", ROUTER);
  console.log("WETH9   :", WETH);

  // -----------------------------
  // Deploy a clean ERC20 test token (your Mock token)
  // -----------------------------
  // IMPORTANT: adjust contract name if your mock differs:
  // - "MockERC20"
  // - "TestToken"
  // - "ERC20Mock"
  // In your case earlier you had a mock deploy script; here we try "MockERC20" first.
  let TokenFactory;
  const candidates = ["MockERC20", "TestToken", "ERC20Mock", "MockToken"];
  let tokenNameUsed = null;

  for (const name of candidates) {
    try {
      TokenFactory = await hre.ethers.getContractFactory(name);
      tokenNameUsed = name;
      break;
    } catch (_) {}
  }
  if (!TokenFactory) {
    throw new Error(
      `No mock ERC20 contract found. Tried: ${candidates.join(", ")}. ` +
      `Tell me the actual contract name of your ERC20 mock.`
    );
  }

  console.log("Using token contract:", tokenNameUsed);

  // Try typical constructors:
  // - constructor(string name, string symbol)
  // - constructor(string name, string symbol, uint8 decimals)
  // - constructor() (then name/symbol hardcoded)
  const tokenArtifact = await hre.artifacts.readArtifact(tokenNameUsed);
  const ctor = tokenArtifact.abi.find((x) => x.type === "constructor");
  const inputs = ctor ? (ctor.inputs || []) : [];
  console.log("Token constructor inputs:", inputs.map(i => `${i.name || "(noname)"}:${i.type}`).join(", ") || "(none)");

  let token;
  if (inputs.length === 0) {
    token = await TokenFactory.deploy();
  } else if (inputs.length === 2) {
    token = await TokenFactory.deploy("Test Token", "TST");
  } else if (inputs.length === 3) {
    token = await TokenFactory.deploy("Test Token", "TST", 18);
  } else {
    throw new Error(`Unexpected token constructor args length: ${inputs.length}`);
  }

  await token.waitForDeployment();
  const TST = await token.getAddress();
  console.log("TST token:", TST);

  // -----------------------------
  // Mint TST to deployer (assumes mint(address,uint256) exists)
  // -----------------------------
  const mintSelector = hre.ethers.id("mint(address,uint256)").slice(0, 10);
  const code = await hre.ethers.provider.getCode(TST);
  if (!code.toLowerCase().includes(mintSelector.slice(2).toLowerCase())) {
    throw new Error("Token does not contain mint(address,uint256). Use a mintable mock token.");
  }

  const amountTST = hre.ethers.parseUnits("1000000", 18); // 1,000,000 TST
  const mintTx = await token.mint(deployer.address, amountTST);
  await mintTx.wait();
  console.log("Minted TST:", hre.ethers.formatUnits(amountTST, 18));

  const balTST = await token.balanceOf(deployer.address);
  console.log("Deployer TST balance:", hre.ethers.formatUnits(balTST, 18));

  // -----------------------------
  // Wrap some native ETH into WETH9
  // -----------------------------
  const weth = await hre.ethers.getContractAt("contracts/WETH9.sol:WETH9", WETH);
  const wrapAmount = hre.ethers.parseEther("10"); // wrap 10 ETH (local)
  const depBalNative = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer native before wrap:", hre.ethers.formatEther(depBalNative));

  const depTx = await weth.deposit({ value: wrapAmount });
  await depTx.wait();
  console.log("Wrapped into WETH:", hre.ethers.formatEther(wrapAmount));

  const balWETH = await weth.balanceOf(deployer.address);
  console.log("Deployer WETH balance:", hre.ethers.formatEther(balWETH));

  // -----------------------------
  // Create Pair (TST/WETH)
  // -----------------------------
  const factory = await hre.ethers.getContractAt("UniswapV2Factory", FACTORY);

  // Uniswap V2 sorts token0/token1 by address; we’ll just pass (TST, WETH)
  let pairAddr = await factory.getPair(TST, WETH);
  if (pairAddr === hre.ethers.ZeroAddress) {
    const tx = await factory.createPair(TST, WETH);
    const rcpt = await tx.wait();

    // Find PairCreated event
    const evt = rcpt.logs
      .map((log) => {
        try { return factory.interface.parseLog(log); } catch { return null; }
      })
      .find((e) => e && e.name === "PairCreated");

    if (!evt) throw new Error("PairCreated event not found");
    pairAddr = evt.args.pair;
  }

  console.log("Pair:", pairAddr);

  const pairCode = await hre.ethers.provider.getCode(pairAddr);
  console.log("Pair codeLen:", (pairCode.length - 2) / 2);

  const pair = await hre.ethers.getContractAt("UniswapV2Pair", pairAddr);
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  console.log("token0:", token0);
  console.log("token1:", token1);

  // -----------------------------
  // Manual addLiquidity (transfer to pair + mint)
  // -----------------------------
  const depositTST = hre.ethers.parseUnits("1000", 18);
  const depositWETH = hre.ethers.parseEther("1");

  console.log("Depositing TST:", hre.ethers.formatUnits(depositTST, 18));
  console.log("Depositing WETH:", hre.ethers.formatEther(depositWETH));

  // transfer tokens to pair
  await (await token.transfer(pairAddr, depositTST)).wait();
  await (await weth.transfer(pairAddr, depositWETH)).wait();

  // mint LP to deployer
  const mintLpTx = await pair.mint(deployer.address);
  const mintLpRcpt = await mintLpTx.wait();
  console.log("pair.mint status:", mintLpRcpt.status);

  const lpBal = await pair.balanceOf(deployer.address);
  console.log("LP balance:", lpBal.toString());

  // Check reserves vs balances (must be coherent)
  const reserves = await pair.getReserves();
  const r0 = reserves[0];
  const r1 = reserves[1];

  const bal0 = await (token0.toLowerCase() === TST.toLowerCase()
    ? token.balanceOf(pairAddr)
    : weth.balanceOf(pairAddr));

  const bal1 = await (token1.toLowerCase() === TST.toLowerCase()
    ? token.balanceOf(pairAddr)
    : weth.balanceOf(pairAddr));

  console.log("Reserves raw:", r0.toString(), r1.toString());
  console.log("Pair balances raw:", bal0.toString(), bal1.toString());

  // -----------------------------
  // Swap test: swap 1 TST for WETH via pair directly (manual swap)
  // -----------------------------
  // We do a simple exact-in swap by sending input to pair and calling swap().
  // amountOut calc uses standard formula with 0.3% fee.
  const amountIn = hre.ethers.parseUnits("1", 18);

  // Determine which side is TST
  const isTst0 = token0.toLowerCase() === TST.toLowerCase();
  const reserveIn = isTst0 ? r0 : r1;
  const reserveOut = isTst0 ? r1 : r0;

  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  const amountOut = numerator / denominator;

  console.log("Swap: amountIn TST:", hre.ethers.formatUnits(amountIn, 18));
  console.log("Expected amountOut WETH:", hre.ethers.formatEther(amountOut));

  // Transfer input to pair
  await (await token.transfer(pairAddr, amountIn)).wait();

  // swap parameters
  const amount0Out = isTst0 ? 0n : amountOut;
  const amount1Out = isTst0 ? amountOut : 0n;

  const swapTx = await pair.swap(amount0Out, amount1Out, deployer.address, "0x");
  const swapRcpt = await swapTx.wait();
  console.log("swap status:", swapRcpt.status);

  const afterWeth = await weth.balanceOf(deployer.address);
  const afterTst = await token.balanceOf(deployer.address);
  console.log("Deployer balances after swap:");
  console.log("  TST:", hre.ethers.formatUnits(afterTst, 18));
  console.log("  WETH:", hre.ethers.formatEther(afterWeth));

  // Final reserves sanity
  const res2 = await pair.getReserves();
  console.log("Reserves after swap raw:", res2[0].toString(), res2[1].toString());

  console.log("E2E local OK ✅");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
