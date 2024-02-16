import {platform} from 'os';
import {readFileSync, existsSync} from 'fs';
import {resolve, relative} from 'path';

import {program} from 'commander';
import {EVM} from '@ethereumjs/evm';
import {Account, Address, hexToBytes, bytesToHex} from '@ethereumjs/util';
import {RLP} from '@ethereumjs/rlp';
import {DefaultStateManager} from '@ethereumjs/statemanager';
import {Trie} from '@ethereumjs/trie';

const solc = require('solc');

program
  .name('tokamak-predeploy-contract-injector')
  .description('Inject contract bytecode to genesis')
  .version('1.0.0')
  .requiredOption('-g, --genesis-file <PATH>', 'path of genesis file')
  .requiredOption(
    '-ca, --contract-address <ADDRESS>',
    'address of contract you want to inject',
    '0x0000000000000000000000000000000000000042'
  )
  .requiredOption('-b, --base-path <PATH>', 'base path of contract')
  .requiredOption(
    '-cn, --contract-name <STRING>',
    'name of main contract',
    'MainContract'
  )
  .requiredOption(
    '-cf, --contract-file <PATH>',
    'path of main contract file',
    'MainContract.sol'
  )
  .option(
    '-c, --constructor <ARGS...>',
    'constructor of contracts',
    'uint256 2345675643 uint256 333'
  )
  .option(
    '-s, --sender-address <ADDRESS>',
    'address of sender to deploy contract (It can be any address without sign. It used only to set storage if there is a logic in the contract constructor)'
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

function withUnixPathSeparators(filePath: string) {
  // On UNIX-like systems forward slashes in paths are just a part of the file name.
  if (platform() !== 'win32') {
    return filePath;
  }

  return filePath.replace(/\\/g, '/');
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
    return withUnixPathSeparators(relativeSourcePath);
  }

  // File is not located inside base path or include paths so use its absolute path.
  return withUnixPathSeparators(absoluteSourcePath);
}

async function main() {
  const genesisJSON = JSON.parse(readFileSync(options.genesisFile).toString());

  const input = {
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
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {import: readFileCallback})
  );

  const evm = new EVM({
    stateManager: new DefaultStateManager({
      trie: new Trie({useKeyHashing: false}),
    }),
  });

  const contractAddress = new Address(hexToBytes(options.contractAddress));
  evm.stateManager.putAccount(contractAddress, new Account());

  await evm.runCode({
    caller: options.senderAddress
      ? new Address(hexToBytes(options.senderAddress))
      : undefined,
    to: contractAddress,
    code: hexToBytes(
      '0x' +
        output.contracts[
          makeSourcePathRelativeIfPossible(options.contractFile)
        ][options.contractName].evm.bytecode.object
    ),
  });

  const contractStorage = await evm.stateManager.dumpStorage(contractAddress);

  console.log(contractStorage);

  for (const [key, value] of Object.entries(contractStorage)) {
    console.log(key, value);

    const decoded = RLP.decode(value) as Uint8Array;
    console.log(bytesToHex(decoded));
  }

  // const decode = RLP.decode(dump[Object.keys(dump)[0]]) as Uint8Array;
  // console.log(bytesToHex(decode));
}

main();
