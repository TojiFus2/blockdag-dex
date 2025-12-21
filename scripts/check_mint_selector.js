const hre = require("hardhat");

async function main() {
  const TOKEN = "0x971870797ffAA25caC23c22Fcf7ED2688E10d670";

  const code = await hre.ethers.provider.getCode(TOKEN);
  const selector = hre.ethers.id("mint(address,uint256)").slice(0, 10); // 4-byte selector
  const found = code.toLowerCase().includes(selector.slice(2).toLowerCase());

  console.log("TOKEN:", TOKEN);
  console.log("codeLen:", (code.length - 2) / 2);
  console.log("selector mint(address,uint256):", selector);
  console.log("selector found in bytecode:", found);
}

main().catch((e) => { console.error(e); process.exit(1); });
