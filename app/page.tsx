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
  parseEther,
} from 'viem';
import { zkSyncSepoliaTestnet } from 'viem/chains';
import {
  eip712WalletActions,
  getGeneralPaymasterInput,
} from 'viem/zksync';

// --- CONFIG ---
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
      addLog('=== Testing Gasless Transaction ===');

      // Create wallet client with EIP-712 actions
      const walletClient = createWalletClient({
        account: address,
        chain: lensTestnet,
        transport: custom(window.ethereum),
      }).extend(eip712WalletActions());

      addLog('Wallet client created with eip712WalletActions');

      // Generate paymaster input using viem's utility
      const paymasterInput = getGeneralPaymasterInput({ innerInput: '0x' });
      addLog(`Paymaster input: ${paymasterInput.slice(0, 20)}...`);

      addLog('Sending transaction via walletClient.sendTransaction...');

      // Use viem's native sendTransaction with paymaster
      const hash = await walletClient.sendTransaction({
        to: address, // send to self
        value: 0n,
        paymaster: PAYMASTER_ADDRESS,
        paymasterInput,
      });

      addLog(`=== SUCCESS ===`);
      addLog(`TX: ${hash}`);
      addLog(`https://block-explorer.testnet.lens.dev/tx/${hash}`);

    } catch (err: any) {
      addLog(`ERROR: ${err.message}`);
      if (err.shortMessage) addLog(`Short: ${err.shortMessage}`);
      console.error('Full error:', err);
    }
  };

  // Test without paymaster (self-funded)
  const postSelfFunded = async () => {
    if (!address) return;
    clearLogs();

    try {
      await ensureNetwork();
      addLog('=== Testing Self-Funded Transaction ===');

      const walletClient = createWalletClient({
        account: address,
        chain: lensTestnet,
        transport: custom(window.ethereum),
      });

      addLog('Sending regular transaction (no paymaster)...');

      const hash = await walletClient.sendTransaction({
        to: address,
        value: 0n,
      });

      addLog(`=== SUCCESS ===`);
      addLog(`TX: ${hash}`);
      addLog(`https://block-explorer.testnet.lens.dev/tx/${hash}`);

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
          <div className="flex gap-4 flex-wrap">
            <button
              onClick={postGasless}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold"
            >
              GASLESS (Paymaster)
            </button>
            <button
              onClick={postSelfFunded}
              className="bg-yellow-600 hover:bg-yellow-700 text-white px-6 py-3 rounded-lg font-semibold"
            >
              SELF-FUNDED (No Paymaster)
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
