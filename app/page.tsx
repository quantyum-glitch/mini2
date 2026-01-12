// @ts-nocheck
'use client';

import { useState } from 'react';
import { createWalletClient, custom, Address, defineChain, getAddress, encodeFunctionData } from 'viem';
import { zkSyncSepoliaTestnet } from 'viem/chains';
import { eip712WalletActions } from 'viem/zksync';
import { StakeManagerABI } from '../web3/abi';

// --- CONFIG ---
// Hardcoded lowercase to ensure initial validity, but we will sanitize with getAddress() anyway.
const STAKE_MANAGER_ADDRESS = '0xb42550f0038827727142a9e52579f2e616b20894' as Address;
const PAYMASTER_ADDRESS = '0x2ac838ebceb627f098c15904f090637ff07a76ed' as Address;
const CHAIN_ID = 37111;

// Define custom chain using ZKsync base to ensure formatters are present
const lensTestnet = defineChain({
  ...zkSyncSepoliaTestnet,
  id: 37111,
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

// --- HELPERS ---
// General paymaster selector (0x8c5a3445) + empty inner input
const GENERAL_PAYMASTER_INPUT = '0x8c5a344500000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

function randomHex(length: number): `0x${string}` {
  if (typeof window === 'undefined') return ('0x' + '0'.repeat(length * 2)) as `0x${string}`;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}

// Use viem's native eip712WalletActions for proper ZKsync transaction handling
async function sendGaslessTransaction(
  walletClient: ReturnType<typeof createWalletClient>,
  account: Address,
  to: Address,
  data: `0x${string}`,
  paymasterAddress: Address,
  paymasterInput: `0x${string}`,
  addLog: (msg: string) => void
): Promise<`0x${string}`> {
  addLog('DEBUG: Using eip712WalletActions for native ZKsync tx...');

  try {
    const safeAccount = getAddress(account);
    const safeTo = getAddress(to);
    const safePaymaster = getAddress(paymasterAddress);

    addLog(`DEBUG: account=${safeAccount.slice(0,10)}..., to=${safeTo.slice(0,10)}...`);
    addLog(`DEBUG: paymaster=${safePaymaster.slice(0,10)}...`);

    // Extend wallet client with EIP-712 actions
    const zkWalletClient = walletClient.extend(eip712WalletActions());

    addLog('DEBUG: Sending transaction via zkWalletClient.sendTransaction...');

    // Use the native sendTransaction which handles EIP-712 signing + serialization + sending
    const hash = await zkWalletClient.sendTransaction({
      account: safeAccount,
      to: safeTo,
      data,
      paymaster: safePaymaster,
      paymasterInput,
      type: 'eip712',
    });

    addLog(`DEBUG: Transaction hash received: ${hash}`);
    return hash;

  } catch (err: any) {
    addLog(`CRITICAL ERROR: ${err.message}`);
    console.error('Full error:', err);
    if (err.cause) console.error('Cause:', err.cause);
    throw err;
  }
}

export default function Home() {
  const [address, setAddress] = useState<Address | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs(prev => [...prev, `> ${msg}`]);

  const ensureNetwork = async () => {
    // @ts-ignore
    const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
    const currentChainId = parseInt(chainIdHex, 16);
    addLog(`Current Chain ID: ${currentChainId}`);

    if (currentChainId !== CHAIN_ID) {
      addLog(`Switching to Chain ${CHAIN_ID}...`);
      try {
        // @ts-ignore
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + CHAIN_ID.toString(16) }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          addLog("Chain not found, adding...");
          // @ts-ignore
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: '0x' + CHAIN_ID.toString(16),
                chainName: 'Lens Testnet',
                rpcUrls: ['https://rpc.testnet.lens.dev'],
                blockExplorerUrls: ['https://block-explorer.testnet.lens.dev'],
                nativeCurrency: { name: 'GRASS', symbol: 'GRASS', decimals: 18 }
              },
            ],
          });
        } else {
          throw switchError;
        }
      }
    }
  };

  const connect = async () => {
    // @ts-ignore
    if (!window.ethereum) return alert('No Wallet');
    // @ts-ignore
    const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setAddress(addr);
    addLog(`Connected: ${addr}`);
    await ensureNetwork();
  };

  const post = async () => {
    try {
      if (!address) return;
      await ensureNetwork();

      addLog('Starting Gasless Post...');

      const walletClient = createWalletClient({
        account: address,
        chain: lensTestnet,
        // @ts-ignore
        transport: custom(window.ethereum)
      });

      // Dummy Data for stakePost
      const targetId = randomHex(32);
      const groveHash = randomHex(32);
      const boardId = randomHex(32);

      addLog(`targetId: ${targetId.slice(0, 18)}...`);
      addLog(`groveHash: ${groveHash.slice(0, 18)}...`);

      const data = encodeFunctionData({
        abi: StakeManagerABI,
        functionName: 'stakePost',
        args: [targetId, groveHash, boardId, 0n],
      });

      addLog('Requesting EIP-712 Signature via Wallet...');

      const hash = await sendGaslessTransaction(
        walletClient,
        address,
        STAKE_MANAGER_ADDRESS,
        data,
        PAYMASTER_ADDRESS,
        GENERAL_PAYMASTER_INPUT,
        addLog
      );

      addLog(`Success! TX: ${hash}`);
      addLog(`Explorer: https://block-explorer.testnet.lens.dev/tx/${hash}`);
    } catch (e: any) {
      addLog(`Error: ${e.message}`);
      if (e.cause) console.error(e.cause);
      console.error(e);
    }
  };

  return (
    <main className="p-10 font-mono">
      <h1 className="text-xl font-bold mb-4">Mini2 Gasless Demo</h1>
      {!address ? (
        <button onClick={connect} className="bg-blue-500 text-white p-2">Connect Wallet</button>
      ) : (
        <div className="space-y-4">
          <p>Wallet: {address}</p>
          <button onClick={post} className="bg-green-500 text-white p-2">POST GASLESS (Fresh Wallet)</button>
        </div>
      )}
      <div className="mt-8 bg-gray-900 text-green-400 p-4 min-h-[200px]">
        {logs.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </main>
  );
}
