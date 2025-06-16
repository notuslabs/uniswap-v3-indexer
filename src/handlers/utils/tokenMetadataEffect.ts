import { experimental_createEffect, S } from "envio";
import { createPublicClient, http, getContract, type PublicClient } from "viem";
import { ADDRESS_ZERO } from "./constants";
import { getChainConfig } from "./chains";
import * as dotenv from "dotenv";
import * as cache from "./cache";
import supportedTokenAddresses from "./supportedTokenAddresses.json";

dotenv.config();

const ERC20_ABI = [
	{
		inputs: [],
		name: "name",
		outputs: [{ type: "string" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "NAME",
		outputs: [{ type: "bytes32" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "symbol",
		outputs: [{ type: "string" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "SYMBOL",
		outputs: [{ type: "bytes32" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [],
		name: "decimals",
		outputs: [{ type: "uint8" }],
		stateMutability: "view",
		type: "function",
	},
] as const;

// Helper function to get RPC URL for a chain
const getRpcUrl = (chainId: number): string => {
	switch (chainId) {
		case 1:
			return process.env.MAINNET_RPC_URL || "https://eth.drpc.org";
		case 42161:
			return process.env.ARBITRUM_RPC_URL || "https://arbitrum.drpc.org";
		case 10:
			return process.env.OPTIMISM_RPC_URL || "https://optimism.drpc.org";
		case 8453:
			return process.env.BASE_RPC_URL || "https://base.drpc.org";
		case 137:
			return process.env.POLYGON_RPC_URL || "https://polygon.drpc.org";
		case 43114:
			return process.env.AVALANCHE_RPC_URL || "https://avalanche.drpc.org";
		case 56:
			return process.env.BSC_RPC_URL || "https://bsc.drpc.org";
		case 81457:
			return process.env.BLAST_RPC_URL || "https://blast.drpc.org";
		case 7777777:
			return process.env.ZORA_RPC_URL || "https://zora.drpc.org";
		case 1868:
			return process.env.SONIEUM_RPC_URL || "https://sonieum.drpc.org";
		case 130:
			return process.env.UNICHAIN_RPC_URL || "https://unichain.drpc.org";
		case 57073:
			return process.env.INK_RPC_URL || "https://ink.drpc.org";
		default:
			throw new Error(`No RPC URL configured for chainId ${chainId}`);
	}
};

// Cache of clients per chainId
const clients: Record<number, PublicClient> = {};

// Function to sanitize strings
function sanitizeString(str: string): string {
	if (!str) return "";
	// Using a simpler regex to avoid control characters
	return str.replace(/[^\x20-\x7E]/g, "").trim();
}

interface TokenMetadata {
	name: string;
	symbol: string;
	decimals: number;
	supported: boolean;
}

// Create the token metadata effect
export const getTokenMetadataEffect = experimental_createEffect(
	{
		name: "getTokenMetadata",
		input: {
			address: S.string,
			chainId: S.number,
		},
		output: {
			name: S.string,
			symbol: S.string,
			decimals: S.number,
			supported: S.boolean,
		},
	},
	async ({ input, context }) => {
		const { address, chainId } = input;
		const supported = supportedTokenAddresses.includes(address.toLowerCase());
		const cacheKey = `${chainId}:${address}`;
		const cacheNamespace = "tokenMetadata";

		// Try to get from cache first
		const cachedMetadata = await cache.get<TokenMetadata>(
			cacheNamespace,
			cacheKey,
		);
		if (cachedMetadata) {
			context.log.info(
				`Using cached metadata for token ${address} on chain ${chainId}`,
			);
			return cachedMetadata;
		}

		try {
			// Handle native token
			if (address.toLowerCase() === ADDRESS_ZERO.toLowerCase()) {
				const chainConfig = getChainConfig(chainId);
				const result = {
					name: chainConfig.nativeTokenDetails.name,
					symbol: chainConfig.nativeTokenDetails.symbol,
					decimals: Number(chainConfig.nativeTokenDetails.decimals),
					supported,
				};

				// Cache the result
				await cache.set(cacheNamespace, cacheKey, result);
				return result;
			}

			// Check for token overrides
			const chainConfig = getChainConfig(chainId);
			const tokenOverride = chainConfig.tokenOverrides.find(
				(t) => t.address.toLowerCase() === address.toLowerCase(),
			);

			if (tokenOverride) {
				const result = {
					name: tokenOverride.name,
					symbol: tokenOverride.symbol,
					decimals: Number(tokenOverride.decimals),
					supported,
				};

				// Cache the result
				await cache.set(cacheNamespace, cacheKey, result);
				return result;
			}

			// Get or create a client with batching enabled
			if (!clients[chainId]) {
				clients[chainId] = createPublicClient({
					transport: http(getRpcUrl(chainId), { batch: true }),
				});
				context.log.info(
					`Created client for chain ${chainId} with batching enabled`,
				);
			}

			// Create contract instance with proper typing
			const contract = getContract({
				address: address as `0x${string}`,
				abi: ERC20_ABI,
				client: clients[chainId],
			});

			// Use Promise.all to execute all calls in parallel
			// They will be automatically batched thanks to the batch option
			const promises = [
				contract.read.name().catch(() => null),
				contract.read.NAME().catch(() => null),
				contract.read.symbol().catch(() => null),
				contract.read.SYMBOL().catch(() => null),
				contract.read.decimals().catch(() => 18),
			];

			const results = await Promise.all(promises);
			const nameResult = results[0];
			const nameBytes32Result = results[1] as string | null;
			const symbolResult = results[2];
			const symbolBytes32Result = results[3] as string | null;
			const decimalsResult = results[4];

			// Process name with fallbacks
			let name = "unknown";
			if (nameResult !== null) {
				name = sanitizeString(nameResult as string);
			} else if (nameBytes32Result !== null) {
				name = sanitizeString(
					new TextDecoder().decode(
						new Uint8Array(
							Buffer.from(nameBytes32Result.slice(2), "hex").filter(
								(n) => n !== 0,
							),
						),
					),
				);
			}

			// Process symbol with fallbacks
			let symbol = "UNKNOWN";
			if (symbolResult !== null) {
				symbol = sanitizeString(symbolResult as string);
			} else if (symbolBytes32Result !== null) {
				symbol = sanitizeString(
					new TextDecoder().decode(
						new Uint8Array(
							Buffer.from(symbolBytes32Result.slice(2), "hex").filter(
								(n) => n !== 0,
							),
						),
					),
				);
			}

			const result = {
				name: name || "unknown",
				symbol: symbol || "UNKNOWN",
				decimals: typeof decimalsResult === "number" ? decimalsResult : 18,
				supported,
			};

			context.log.info(
				`Fetched metadata for token ${address} on chain ${chainId}`,
			);

			// Cache the result
			await cache.set(cacheNamespace, cacheKey, result);

			return result;
		} catch (error) {
			context.log.error(
				`Error fetching metadata for ${address} on chain ${chainId}`,
				error as Error,
			);
			return {
				name: "unknown",
				symbol: "UNKNOWN",
				decimals: 18,
				supported,
			};
		}
	},
);
