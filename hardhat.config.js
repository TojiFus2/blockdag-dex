require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { BDAG_RPC_URL, PRIVATE_KEY } = process.env;

function pkArray() {
  if (!PRIVATE_KEY) return [];
  // accetta sia con che senza 0x
  return [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`];
}

module.exports = {
  solidity: {
    compilers: [
      { version: "0.5.16" },
      { version: "0.6.6" },
      { version: "0.8.20" },
    ],
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    bdagTestnet: {
      url: BDAG_RPC_URL || "",
      chainId: 1043,
      accounts: pkArray(),
    },
  },
};
