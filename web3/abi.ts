export const StakeManagerABI = [
    {
        inputs: [
            { internalType: 'bytes32', name: 'targetId', type: 'bytes32' },
            { internalType: 'bytes32', name: 'groveHash', type: 'bytes32' },
            { internalType: 'bytes32', name: 'boardId', type: 'bytes32' },
            { internalType: 'uint256', name: 'amount', type: 'uint256' },
        ],
        name: 'stakePost',
        outputs: [{ internalType: 'uint256', name: 'stakeId', type: 'uint256' }],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const;
