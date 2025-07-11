import {
	type Factory,
	UniswapV3Factory,
	type Bundle,
	type Pool,
	type Token,
} from "generated";
import { ZERO_BD, ZERO_BI, ONE_BI, ADDRESS_ZERO } from "./utils/constants";
import { CHAIN_CONFIGS } from "./utils/chains";
import { isAddressInList, type Writeable } from "./utils/index";
import { getTokenMetadataEffect } from "./utils/tokenMetadataEffect";

UniswapV3Factory.PoolCreated.contractRegister(({ event, context }) => {
	context.addUniswapV3Pool(event.params.pool);
});

UniswapV3Factory.PoolCreated.handlerWithLoader({
	loader: async ({ event, context }) => {
		const { factoryAddress } = CHAIN_CONFIGS[event.chainId];
		const { token0Address, token1Address } = {
			token0Address: event.params.token0,
			token1Address: event.params.token1,
		};

		// Fetch token metadata using the effect API
		// This will automatically batch similar calls
		const [factory, token0RO, token1RO, token0Metadata, token1Metadata] =
			await Promise.all([
				context.Factory.get(`${event.chainId}-${factoryAddress.toLowerCase()}`),
				context.Token.get(`${event.chainId}-${token0Address.toLowerCase()}`),
				context.Token.get(`${event.chainId}-${token1Address.toLowerCase()}`),
				context.effect(getTokenMetadataEffect, {
					address: token0Address,
					chainId: event.chainId,
				}),
				context.effect(getTokenMetadataEffect, {
					address: token1Address,
					chainId: event.chainId,
				}),
			]);

		return {
			factory,
			token0RO,
			token1RO,
			token0Metadata,
			token1Metadata,
			token0Address,
			token1Address,
		};
	},

	handler: async ({ event, context, loaderReturn }) => {
		const {
			factory: factoryRO,
			token0RO,
			token1RO,
			token0Metadata,
			token1Metadata,
			token0Address,
			token1Address,
		} = loaderReturn;

		const { factoryAddress, poolsToSkip, whitelistTokens } =
			CHAIN_CONFIGS[event.chainId];

		// temp fix
		if (isAddressInList(event.params.pool, poolsToSkip)) {
			return;
		}

		let factory: Writeable<Factory> | undefined;

		if (factoryRO) {
			factory = { ...factoryRO };
		} else {
			factory = {
				id: `${event.chainId}-${factoryAddress.toLowerCase()}`,
				poolCount: ZERO_BI,
				numberOfSwaps: ZERO_BI,
				totalVolumeEth: ZERO_BD,
				totalVolumeUsd: ZERO_BD,
				untrackedVolumeUsd: ZERO_BD,
				totalFeesUsd: ZERO_BD,
				totalFeesEth: ZERO_BD,
				totalValueLockedEth: ZERO_BD,
				totalValueLockedUsd: ZERO_BD,
				totalValueLockedUsdUntracked: ZERO_BD,
				totalValueLockedEthUntracked: ZERO_BD,
				txCount: ZERO_BI,
				owner: ADDRESS_ZERO,
			};

			// create new bundle for tracking eth price
			const bundle: Bundle = {
				id: event.chainId.toString(),
				ethPriceUsd: ZERO_BD,
			};

			context.Bundle.set(bundle);
		}

		factory.poolCount = factory.poolCount + ONE_BI;

		// Create token objects using the metadata we fetched in the loader
		const tokens: Writeable<Token>[] = [];

		// Create token0
		if (token0RO) {
			tokens[0] = { ...token0RO };
		} else {
			tokens[0] = {
				id: `${event.chainId}-${token0Address.toLowerCase()}`,
				symbol: token0Metadata.symbol,
				name: token0Metadata.name,
				decimals: BigInt(token0Metadata.decimals),
				isWhitelisted: isAddressInList(token0Address, whitelistTokens),
				volume: ZERO_BD,
				volumeUsd: ZERO_BD,
				untrackedVolumeUsd: ZERO_BD,
				feesUsd: ZERO_BD,
				txCount: ZERO_BI,
				poolCount: ZERO_BI,
				totalValueLocked: ZERO_BD,
				totalValueLockedUsd: ZERO_BD,
				totalValueLockedUsdUntracked: ZERO_BD,
				derivedEth: ZERO_BD,
				whitelistPools: [],
				supported: token0Metadata.supported,
			};
		}

		// Create token1
		if (token1RO) {
			tokens[1] = { ...token1RO };
		} else {
			tokens[1] = {
				id: `${event.chainId}-${token1Address.toLowerCase()}`,
				symbol: token1Metadata.symbol,
				name: token1Metadata.name,
				decimals: BigInt(token1Metadata.decimals),
				isWhitelisted: isAddressInList(token1Address, whitelistTokens),
				volume: ZERO_BD,
				volumeUsd: ZERO_BD,
				untrackedVolumeUsd: ZERO_BD,
				feesUsd: ZERO_BD,
				txCount: ZERO_BI,
				poolCount: ZERO_BI,
				totalValueLocked: ZERO_BD,
				totalValueLockedUsd: ZERO_BD,
				totalValueLockedUsdUntracked: ZERO_BD,
				derivedEth: ZERO_BD,
				whitelistPools: [],
				supported: token0Metadata.supported,
			};
		}

		const pool: Pool = {
			id: `${event.chainId}-${event.params.pool.toLowerCase()}`,
			createdAtTimestamp: BigInt(event.block.timestamp),
			createdAtBlockNumber: BigInt(event.block.number),
			token0_id: tokens[0].id,
			token1_id: tokens[1].id,
			feeTier: event.params.fee,
			liquidity: ZERO_BI,
			sqrtPrice: ZERO_BI,
			token0Price: ZERO_BD,
			token1Price: ZERO_BD,
			tick: BigInt(event.params.tickSpacing),
			observationIndex: ZERO_BI,
			volumeToken0: ZERO_BD,
			volumeToken1: ZERO_BD,
			volumeUsd: ZERO_BD,
			untrackedVolumeUsd: ZERO_BD,
			feesUsd: ZERO_BD,
			txCount: ZERO_BI,
			collectedFeesToken0: ZERO_BD,
			collectedFeesToken1: ZERO_BD,
			collectedFeesUsd: ZERO_BD,
			totalValueLockedToken0: ZERO_BD,
			totalValueLockedToken1: ZERO_BD,
			totalValueLockedEth: ZERO_BD,
			totalValueLockedUsd: ZERO_BD,
			totalValueLockedUsdUntracked: ZERO_BD,
			liquidityProviderCount: ZERO_BI,
			supported: token0Metadata.supported && token1Metadata.supported,
			chainId: event.chainId,
		};

		// update white listed pools
		if (tokens[0].isWhitelisted) {
			tokens[1].whitelistPools.push(pool.id);
		}

		if (tokens[1].isWhitelisted) {
			tokens[0].whitelistPools.push(pool.id);
		}

		context.Pool.set(pool);
		context.Token.set(tokens[0]);
		context.Token.set(tokens[1]);
		context.Factory.set(factory);
	},
});
