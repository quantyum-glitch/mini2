// @ts-nocheck
'use client';

import { useState } from 'react';
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  Address,
  defineChain,
  getAddress,
  encodeFunctionData,
  hexToBigInt,
} from 'viem';
import { zkSyncSepoliaTestnet } from 'viem/chains';
import {
  serializeTransaction,
  type ZkSyncTransactionSerializableEIP712,
} from 'viem/zksync';
import { StakeManagerABI } from '../web3/abi';

// --- CONFIG ---
const STAKE_MANAGER_ADDRESS = '0xb42550f0038827727142a9e52579f2e616b20894' as Address;
// Official Lens Testnet Paymaster (from zks_getTestnetPaymaster RPC)
const PAYMASTER_ADDRESS = '0x2a3221e4e06bb53906c910146653afb85bf448b2' as Address;
const CHAIN_ID = 37111;

// Lens Testnet chain definition
const lensTestnet = defineChain({
  ...zkSyncSepoliaTestnet,
  id: CHAIN_ID,
  name: 'Lens Testnet',
  nativeCurrency: { name: 'GRASS', symbol: 'GRASS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.lens.dev'] },
  },
  blockExplorers: {
    default: { name: 'Lens Explorer', url: 'https://block-explorer.testnet.lens.dev' },
  },
  testnet: true,
});

// Approval-based paymaster flow selector (0x949431dc)
// Format: selector + token + minAllowance + innerInput
// Using zero address for token (native), 0 allowance, empty inner
const PAYMASTER_INPUT = '0x949431dc0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

// --- HELPERS ---
function randomBytes32(): `0x${string}` {
  if (typeof window === 'undefined') return `0x${'0'.repeat(64)}` as `0x${string}`;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

// ZKsync EIP-712 domain
const getEip712Domain = (chainId: number) => ({
  name: 'zkSync',
  version: '2',
  chainId,
});

const EIP712_TX_TYPE = 0x71; // 113 decimal

// ZKsync EIP-712 transaction types
const zkSyncTxTypes = {
  Transaction: [
    { name: 'txType', type: 'uint256' },
    { name: 'from', type: 'uint256' },
    { name: 'to', type: 'uint256' },
    { name: 'gasLimit', type: 'uint256' },
    { name: 'gasPerPubdataByteLimit', type: 'uint256' },
    { name: 'maxFeePerGas', type: 'uint256' },
    { name: 'maxPriorityFeePerGas', type: 'uint256' },
    { name: 'paymaster', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'factoryDeps', type: 'bytes32[]' },
    { name: 'paymasterInput', type: 'bytes' },
  ],
} as const;

function addressToBigInt(addr: Address): bigint {
  return hexToBigInt(addr);
}

// Send gasless ZKsync transaction with paymaster
async function sendGaslessTransaction(
  walletClient: any,
  publicClient: any,
  account: Address,
  to: Address,
  data: `0x${string}`,
  paymaster: Address,
  paymasterInput: `0x${string}`,
  addLog: (msg: string) => void
): Promise<`0x${string}`> {

  addLog('Step 1: Getting nonce and gas price...');

  const [nonce, gasPrice] = await Promise.all([
    publicClient.getTransactionCount({ address: account }),
    publicClient.getGasPrice(),
  ]);

  addLog(`Nonce: ${nonce}, Gas Price: ${gasPrice}`);

  // Use reasonable defaults for ZKsync
  const gasLimit = 500000n;
  const gasPerPubdataByteLimit = 800n;
  const maxFeePerGas = gasPrice;
  const maxPriorityFeePerGas = gasPrice > 100000000n ? 100000000n : gasPrice;

  addLog('Step 2: Building EIP-712 message...');

  const message = {
    txType: BigInt(EIP712_TX_TYPE),
    from: addressToBigInt(account),
    to: addressToBigInt(to),
    gasLimit,
    gasPerPubdataByteLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: addressToBigInt(paymaster),
    nonce: BigInt(nonce),
    value: 0n,
    data,
    factoryDeps: [],
    paymasterInput,
  };

  addLog('Step 3: Requesting EIP-712 signature...');

  const signature = await walletClient.signTypedData({
    account,
    domain: getEip712Domain(CHAIN_ID),
    types: zkSyncTxTypes,
    primaryType: 'Transaction',
    message,
  });

  addLog(`Signature: ${signature.slice(0, 20)}...`);

  addLog('Step 4: Serializing transaction...');

  const txRequest: ZkSyncTransactionSerializableEIP712 = {
    type: 'eip712',
    chainId: CHAIN_ID,
    from: account,
    to,
    nonce,
    gas: gasLimit,
    gasPerPubdata: gasPerPubdataByteLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterInput,
    data,
    value: 0n,
    factoryDeps: [],
    customSignature: signature,
  };

  const serializedTx = serializeTransaction(txRequest);
  addLog(`Serialized: ${serializedTx.length} chars`);

  addLog('Step 5: Sending transaction...');

  const response = await fetch('https://rpc.testnet.lens.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'eth_sendRawTransaction',
      params: [serializedTx],
    }),
  });

  const result = await response.json();

  if (result.error) {
    addLog(`RPC Error: ${JSON.stringify(result.error)}`);
    throw new Error(result.error.message || JSON.stringify(result.error));
  }

  return result.result as `0x${string}`;
}

export default function Home() {
  const [address, setAddress] = useState<Address | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log(msg);
    setLogs(prev => [...prev, `> ${msg}`]);
  };

  const clearLogs = () => setLogs([]);

  const ensureNetwork = async () => {
    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainIdHex, 16);

    if (currentChainId !== CHAIN_ID) {
      addLog(`Switching to Lens Testnet...`);
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
        });
      } catch (err: any) {
        if (err.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${CHAIN_ID.toString(16)}`,
              chainName: 'Lens Testnet',
              rpcUrls: ['https://rpc.testnet.lens.dev'],
              blockExplorerUrls: ['https://block-explorer.testnet.lens.dev'],
              nativeCurrency: { name: 'GRASS', symbol: 'GRASS', decimals: 18 },
            }],
          });
        } else {
          throw err;
        }
      }
    }
    addLog(`Network: Lens Testnet (${CHAIN_ID})`);
  };

  const connect = async () => {
    if (!window.ethereum) {
      alert('Please install MetaMask');
      return;
    }
    const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setAddress(addr);
    addLog(`Connected: ${addr}`);
    await ensureNetwork();
  };

  const postGasless = async () => {
    if (!address) return;
    clearLogs();

    try {
      await ensureNetwork();
      addLog('=== Starting Gasless Transaction ===');

      const walletClient = createWalletClient({
        account: address,
        chain: lensTestnet,
        transport: custom(window.ethereum),
      });

      const publicClient = createPublicClient({
        chain: lensTestnet,
        transport: http(),
      });

      // Generate test data
      const targetId = randomBytes32();
      const groveHash = randomBytes32();
      const boardId = randomBytes32();

      addLog(`Target: ${targetId.slice(0, 18)}...`);

      const callData = encodeFunctionData({
        abi: StakeManagerABI,
        functionName: 'stakePost',
        args: [targetId, groveHash, boardId, 0n],
      });

      const txHash = await sendGaslessTransaction(
        walletClient,
        publicClient,
        address,
        STAKE_MANAGER_ADDRESS,
        callData,
        PAYMASTER_ADDRESS,
        PAYMASTER_INPUT,
        addLog
      );

      addLog(`=== SUCCESS ===`);
      addLog(`TX: ${txHash}`);
      addLog(`https://block-explorer.testnet.lens.dev/tx/${txHash}`);

    } catch (err: any) {
      addLog(`ERROR: ${err.message}`);
      console.error(err);
    }
  };

  return (
    <main className="p-8 font-mono max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Mini2 Gasless Demo</h1>
      <p className="text-sm text-gray-500 mb-4">Lens Testnet | Chain ID: {CHAIN_ID}</p>

      {!address ? (
        <button
          onClick={connect}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold"
        >
          Connect Wallet
        </button>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="text-gray-500">Wallet:</span>{' '}
            <span className="font-medium">{address}</span>
          </p>
          <div className="flex gap-4">
            <button
              onClick={postGasless}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold"
            >
              POST GASLESS
            </button>
            <button
              onClick={clearLogs}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded-lg"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 bg-gray-900 text-green-400 p-4 rounded-lg min-h-[300px] overflow-auto text-sm">
        <div className="text-gray-500 mb-2">// Log</div>
        {logs.length === 0 ? (
          <div className="text-gray-600">Ready...</div>
        ) : (
          logs.map((log, i) => <div key={i} className="py-0.5">{log}</div>)
        )}
      </div>
    </main>
  );
}
