import {
	UniswapV3Pool,
	type Token,
	type Pool,
	type Bundle,
	type Factory,
} from "generated";
import { CHAIN_CONFIGS } from "./utils/chains";
import { ONE_BI } from "./utils/constants";
import { convertTokenToDecimal } from "./utils/index";
import { getTrackedAmountUSD } from "./utils/pricing";
import * as intervalUpdates from "./utils/intervalUpdates";

UniswapV3Pool.Collect.handlerWithLoader({
	loader: async ({ event, context }) => {
		const poolId = `${event.chainId}-${event.srcAddress.toLowerCase()}`;
		const pool = await context.Pool.get(poolId);
		if (!pool) return;

		const { factoryAddress } = CHAIN_CONFIGS[event.chainId];
		const res = await Promise.all([
			context.Bundle.get(event.chainId.toString()),
			context.Factory.get(`${event.chainId}-${factoryAddress.toLowerCase()}`),
			context.Token.get(pool.token0_id),
			context.Token.get(pool.token1_id),
		]);

		return [pool, ...res];
	},

	handler: async ({ event, context, loaderReturn }) => {
		if (!loaderReturn) return;

		for (const item of loaderReturn) {
			if (!item) return;
		}

		const [poolRO, bundle, factoryRO, token0RO, token1RO] = loaderReturn as [
			Pool,
			Bundle,
			Factory,
			Token,
			Token,
		];

		const factory = { ...factoryRO };
		const pool = { ...poolRO };
		const token0 = { ...token0RO };
		const token1 = { ...token1RO };
		const { whitelistTokens } = CHAIN_CONFIGS[event.chainId];
		const timestamp = event.block.timestamp;

		// Get formatted amounts collected.
		const collectedAmountToken0 = convertTokenToDecimal(
			event.params.amount0,
			token0.decimals,
		);
		const collectedAmountToken1 = convertTokenToDecimal(
			event.params.amount1,
			token1.decimals,
		);
		const trackedCollectedAmountUSD = getTrackedAmountUSD(
			bundle,
			collectedAmountToken0,
			token0 as Token,
			collectedAmountToken1,
			token1 as Token,
			whitelistTokens,
		);

		// Reset tvl aggregates until new amounts calculated
		factory.totalValueLockedEth = factory.totalValueLockedEth.minus(
			pool.totalValueLockedEth,
		);

		// Update globals
		factory.txCount = factory.txCount + ONE_BI;

		// update token data
		token0.txCount = token0.txCount + ONE_BI;
		token0.totalValueLocked = token0.totalValueLocked.minus(
			collectedAmountToken0,
		);
		token0.totalValueLockedUsd = token0.totalValueLocked.times(
			token0.derivedEth.times(bundle.ethPriceUsd),
		);

		token1.txCount = token1.txCount + ONE_BI;
		token1.totalValueLocked = token1.totalValueLocked.minus(
			collectedAmountToken1,
		);
		token1.totalValueLockedUsd = token1.totalValueLocked.times(
			token1.derivedEth.times(bundle.ethPriceUsd),
		);

		// Adjust pool TVL based on amount collected.
		pool.txCount = pool.txCount + ONE_BI;
		pool.totalValueLockedToken0 = pool.totalValueLockedToken0.minus(
			collectedAmountToken0,
		);
		pool.totalValueLockedToken1 = pool.totalValueLockedToken1.minus(
			collectedAmountToken1,
		);
		pool.totalValueLockedEth = pool.totalValueLockedToken0
			.times(token0.derivedEth)
			.plus(pool.totalValueLockedToken1.times(token1.derivedEth));
		pool.totalValueLockedUsd = pool.totalValueLockedEth.times(
			bundle.ethPriceUsd,
		);

		// Update aggregate fee collection values.
		pool.collectedFeesToken0 = pool.collectedFeesToken0.plus(
			collectedAmountToken0,
		);
		pool.collectedFeesToken1 = pool.collectedFeesToken1.plus(
			collectedAmountToken1,
		);
		pool.collectedFeesUsd = pool.collectedFeesUsd.plus(
			trackedCollectedAmountUSD,
		);

		// reset aggregates with new amounts
		factory.totalValueLockedEth = factory.totalValueLockedEth.plus(
			pool.totalValueLockedEth,
		);
		factory.totalValueLockedUsd = factory.totalValueLockedEth.times(
			bundle.ethPriceUsd,
		);

		intervalUpdates.updatePoolDayData(timestamp, pool, context);
		intervalUpdates.updatePoolHourData(timestamp, pool, context);

		context.Token.set(token0);
		context.Token.set(token1);
		context.Pool.set(pool);
		context.Factory.set(factory);
	},
});
