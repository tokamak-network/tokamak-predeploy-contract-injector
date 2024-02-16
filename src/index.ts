import {exit} from 'process';
import {readFileSync, existsSync, writeFileSync} from 'fs';
import {resolve, relative} from 'path';

import {program} from 'commander';
import {encodeParameters} from 'web3-eth-abi';
import {EVM} from '@ethereumjs/evm';
import {DefaultStateManager} from '@ethereumjs/statemanager';
import {Trie} from '@ethereumjs/trie';
import {RLP} from '@ethereumjs/rlp';
import {
  Account,
  Address,
  hexToBytes,
  bytesToHex,
  stripHexPrefix,
  addHexPrefix,
} from '@ethereumjs/util';

const solc = require('solc');

program
  .name('tokamak-predeploy-contract-injector')
  .description('Inject contract bytecode to genesis')
  .version('1.0.0')
  .requiredOption('-g, --genesis-file <PATH>', 'path of genesis file')
  .requiredOption(
    '-ca, --contract-address <ADDRESS>',
    'address of contract you want to inject (example: "0x0000000000000000000000000000000000000042")'
  )
  .requiredOption('-b, --base-path <PATH>', 'base path of contract')
  .requiredOption(
    '-cn, --contract-name <STRING>',
    'name of main contract (example: "MainContract")'
  )
  .requiredOption(
    '-cf, --contract-file <PATH>',
    'path of main contract file (example: "MainContract.sol")'
  )
  .option(
    '-cc, --contract-constructor <ARGS...>',
    'constructor(type and value) of contracts (example: "uint256 uint256 2345675643 333")'
  )
  .option(
    '-s, --sender-address <ADDRESS>',
    'address of sender to deploy contract (It can be any address without sign. It used only to set storage if there is a logic in the contract constructor)'
  )
  .option(
    '-cr, --contract-remappings <ARGS...>',
    'remapping config (example: "@openzeppelin/contracts-upgradeable=lib/openzeppelin-contracts-upgradeable/contracts @openzeppelin/contracts=lib/openzeppelin-contracts/contracts")'
  );

program.parse();

const options = program.opts();

function readFileCallback(sourcePath: string) {
  const prefix = options.basePath;
  const prefixedSourcePath = (prefix ? prefix + '/' : '') + sourcePath;

  if (existsSync(prefixedSourcePath)) {
    try {
      return {contents: readFileSync(prefixedSourcePath).toString('utf8')};
    } catch (e) {
      return {error: 'Error reading ' + prefixedSourcePath + ': ' + e};
    }
  }

  return {
    error: 'File not found inside the base path or any of the include paths.',
  };
}

function makeSourcePathRelativeIfPossible(sourcePath: string) {
  const absoluteBasePath = options.basePath
    ? resolve(options.basePath)
    : resolve('.');

  // Compared to base path stripping logic in solc this is much simpler because path.resolve()
  // handles symlinks correctly (does not resolve them except in work dir) and strips .. segments
  // from paths going beyond root (e.g. `/../../a/b/c` -> `/a/b/c/`). It's simpler also because it
  // ignores less important corner cases: drive letters are not stripped from absolute paths on
  // Windows and UNC paths are not handled in a special way (at least on Linux). Finally, it has
  // very little test coverage so there might be more differences that we are just not aware of.
  const absoluteSourcePath = resolve(sourcePath);

  const absolutePrefix = absoluteBasePath;
  const relativeSourcePath = relative(absolutePrefix, absoluteSourcePath);

  if (!relativeSourcePath.startsWith('../')) {
    return relativeSourcePath;
  }

  // File is not located inside base path or include paths so use its absolute path.
  return absoluteSourcePath;
}

async function main() {
  const genesisJSON = JSON.parse(readFileSync(options.genesisFile).toString());
  const contractAddress = new Address(hexToBytes(options.contractAddress));

  const contractConstructorArray = String(options.contractConstructor).split(
    ','
  );
  const contractConstructor = options.contractConstructor
    ? encodeParameters(
        contractConstructorArray.slice(0, contractConstructorArray.length / 2),
        contractConstructorArray.slice(contractConstructorArray.length / 2)
      )
    : '';

  if (genesisJSON.alloc[stripHexPrefix(contractAddress.toString())]) {
    console.log('Already exist contract address!');
    exit(1);
  }
  genesisJSON.alloc[stripHexPrefix(contractAddress.toString())] = {
    balance: addHexPrefix('0'),
    storage: {},
  };

  const input: {
    language: string;
    sources: {};
    settings: {
      optimizer: {
        enabled: boolean;
        runs: number;
      };
      outputSelection: {};
      remappings?: string[];
    };
  } = {
    language: 'Solidity',
    sources: {
      [makeSourcePathRelativeIfPossible(options.contractFile)]: {
        content: readFileSync(options.contractFile).toString(),
      },
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 999999,
      },
      outputSelection: {
        '*': {
          '*': ['*'],
        },
      },
      remappings: String(options.contractRemappings).split(','),
    },
  };

  if (input.settings.remappings && input.settings.remappings[0] === 'undefined')
    delete input.settings.remappings;

  const output = JSON.parse(
    await solc.compile(JSON.stringify(input), {import: readFileCallback})
  );

  const evm = new EVM({
    stateManager: new DefaultStateManager({
      trie: new Trie({useKeyHashing: false}),
    }),
  });

  evm.stateManager.putAccount(contractAddress, new Account());
  await evm.runCode({
    caller: options.senderAddress
      ? new Address(hexToBytes(options.senderAddress))
      : undefined,
    to: contractAddress,
    code: hexToBytes(
      addHexPrefix(
        output.contracts[
          makeSourcePathRelativeIfPossible(options.contractFile)
        ][options.contractName].evm.bytecode.object +
          stripHexPrefix(contractConstructor)
      )
    ),
  });

  const contractBytecode = addHexPrefix(
    output.contracts[makeSourcePathRelativeIfPossible(options.contractFile)][
      options.contractName
    ].evm.deployedBytecode.object
  );
  genesisJSON.alloc[stripHexPrefix(contractAddress.toString())].code =
    contractBytecode;

  const contractStorage = await evm.stateManager.dumpStorage(contractAddress);
  for (const [key, value] of Object.entries(contractStorage)) {
    const decoded = RLP.decode(value) as Uint8Array;
    genesisJSON.alloc[stripHexPrefix(contractAddress.toString())].storage[key] =
      addHexPrefix(stripHexPrefix(bytesToHex(decoded)).padStart(64, '0'));
  }

  writeFileSync(
    'genesis_new_' + Date.now() + '.json',
    JSON.stringify(genesisJSON, null, 2)
  );
}

main();
