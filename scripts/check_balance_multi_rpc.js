const { ethers } = require("ethers");

const ADDR = "0x52328804e9F1eCFa5d0CCd5a54A32Fcc5B8BAD85";

// Metti qui RPC alternativi se li hai (anche solo 1 basta)
const RPCS = [
  "https://rpc.awakening.bdagscan.com",
  // "INCOLLA QUI eventuale RPC 2",
  // "INCOLLA QUI eventuale RPC 3",
];

async function main() {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const net = await p.getNetwork();
      const bal = await p.getBalance(ADDR);
      const nonce = await p.getTransactionCount(ADDR, "latest");
      console.log("\nRPC:", url);
      console.log("chainId:", net.chainId.toString());
      console.log("balance raw:", bal.toString());
      console.log("balance:", ethers.formatEther(bal));
      console.log("nonce latest:", nonce);
    } catch (e) {
      console.log("\nRPC:", url);
      console.log("ERROR:", e.message || String(e));
    }
  }
}

main();
