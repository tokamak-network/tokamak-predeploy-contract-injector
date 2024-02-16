# tokamak-predeploy-contract-injector

This package is for injecting predeploy contract to genesis file. If you include smart contract written solidity as the input, this package will compile it and add the contract bytecode into genesisfile.

# Prerequisite

- Nodejs (https://nodejs.org/en/download)
- Yarn 1 (https://classic.yarnpkg.com/en/docs/install)

# Play

### 1. Install node_modules

```
yarn install
```

### 2. Help

```
yarn start --help
```

Output

```
Usage: tokamak-predeploy-contract-injector [options]

Inject contract bytecode to genesis

Options:
  -V, --version                          output the version number
  -g, --genesis-file <PATH>              path of genesis file
  -ca, --contract-address <ADDRESS>      address of contract you want to inject (example: "0x0000000000000000000000000000000000000042")
  -b, --base-path <PATH>                 base path of contract
  -cn, --contract-name <STRING>          name of main contract (example: "MainContract")
  -cf, --contract-file <PATH>            path of main contract file (example: "MainContract.sol")
  -cc, --contract-constructor <ARGS...>  constructor(type and value) of contracts (example: "uint256 uint256 2345675643 333")
  -s, --sender-address <ADDRESS>         address of sender to deploy contract (It can be any address without sign. It used only to set storage if there is a logic in the contract constructor)
  -cr, --contract-remappings <ARGS...>   remapping config (example: "@openzeppelin/contracts-upgradeable=lib/openzeppelin-contracts-upgradeable/contracts
                                         @openzeppelin/contracts=lib/openzeppelin-contracts/contracts")
  -h, --help                             display help for command
```

### 3. Example

```
yarn start \
-g ./genesis-l2.json \
-ca 0x0000000000000000000000000000000000000042 \
-b ../tokamak-titan-canyon/packages/tokamak/contracts-bedrock/ \
-cn Proxy \
-cf ../tokamak-titan-canyon/packages/tokamak/contracts-bedrock/src/universal/Proxy.sol \
-cr @openzeppelin/contracts-upgradeable=lib/openzeppelin-contracts-upgradeable/contracts @openzeppelin/contracts=lib/openzeppelin-contracts/contracts @rari-capital/solmate=lib/solmate @cwia/=lib/clones-with-immutable-args/src forge-std=lib/forge-std/src ds-test=lib/forge-std/lib/ds-test/src safe-contracts=lib/safe-contracts/contracts \
-cc address 0x1000000000000000000000000000000000000042
```
