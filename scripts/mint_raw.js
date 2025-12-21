const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;

  const TOKEN = "0x971870797ffAA25caC23c22Fcf7ED2688E10d670";
  const from = deployer.address;

  const iface = new hre.ethers.Interface([
    "function mint(address to, uint256 amount)"
  ]);

  const amount = hre.ethers.parseUnits("1000000", 18);
  const data = iface.encodeFunctionData("mint", [from, amount]);

  console.log("to(token):", TOKEN);
  console.log("from:", from);
  console.log("dataLen:", data.length);
  console.log("dataHead:", data.slice(0, 10)); // 0x40c10f19

  // Balance check in the same run
  const bal = await provider.getBalance(from);
  console.log("native balance raw:", bal.toString());
  console.log("native balance fmt:", hre.ethers.formatEther(bal));

  if (bal === 0n) {
    console.log("RPC returned 0 balance in this run -> aborting tx.");
    return;
  }

  // Force tx params to avoid eth_estimateGas completely
  const GAS_LIMIT = 250000n;   // safe for a simple mint
  const GAS_PRICE = 1000000n;  // 0.001? (same order you saw before: 1000007)

  // Nonce on this network is weird. Start from 64 and bump if needed.
  let nonce = 64;

  for (let i = 0; i < 30; i++) {
    try {
      console.log("Trying raw mint with nonce:", nonce);

      const tx = await deployer.sendTransaction({
        to: TOKEN,
        data,
        nonce,
        gasLimit: GAS_LIMIT,
        gasPrice: GAS_PRICE,
        type: 0, // legacy tx => avoids EIP-1559 fee logic
        value: 0n
      });

      console.log("tx:", tx.hash);
      const rcpt = await tx.wait();
      console.log("status:", rcpt.status);
      return;
    } catch (e) {
      const msg = e?.message ? e.message : String(e);

      if (msg.includes("nonce too low")) { nonce++; continue; }

      throw e;
    }
  }

  throw new Error("Failed after trying multiple nonces");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
