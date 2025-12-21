const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;

  const TOKEN = "0x971870797ffAA25caC23c22Fcf7ED2688E10d670";
  const to = deployer.address;

  const token = new hre.ethers.Contract(
    TOKEN,
    [
      "function mint(address to, uint256 amount) external",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)",
    ],
    deployer
  );

  let dec = 18;
  let sym = "TST";
  try { dec = await token.decimals(); } catch {}
  try { sym = await token.symbol(); } catch {}

  const amount = hre.ethers.parseUnits("1000000", dec);

  console.log("Deployer:", deployer.address);
  console.log("Token:", TOKEN, sym, "dec", dec);
  console.log("Mint amount:", amount.toString());

  // 🔥 NONCE FIX (RPC BROKEN)
  let nonce = 64; // start from what chain expects (from previous error)

  for (let i = 0; i < 10; i++) {
    try {
      console.log("Trying mint with nonce:", nonce);

      const tx = await token.mint(to, amount, { nonce });
      console.log("Mint tx:", tx.hash);

      const rcpt = await tx.wait();
      console.log("Mint status:", rcpt.status);

      const bal = await token.balanceOf(to);
      console.log("New balance:", hre.ethers.formatUnits(bal, dec));

      return;
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);

      if (msg.includes("nonce too low")) {
        nonce++;
        continue;
      }

      throw e;
    }
  }

  throw new Error("Failed to find correct nonce after 10 attempts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
