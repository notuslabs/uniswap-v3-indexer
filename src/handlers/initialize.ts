import { UniswapV3Pool, type Token, type Pool, type Bundle } from "generated";
import { CHAIN_CONFIGS } from "./utils/chains";
import { findNativePerToken, getNativePriceInUSD } from "./utils/pricing";
import { updatePoolDayData, updatePoolHourData } from "./utils/intervalUpdates";

UniswapV3Pool.Initialize.handlerWithLoader({
	loader: async ({ event, context }) => {
		const poolId = `${event.chainId}-${event.srcAddress.toLowerCase()}`;
		const pool = await context.Pool.get(poolId);
		if (!pool) return;

		const res = await Promise.all([
			context.Bundle.get(event.chainId.toString()),
			context.Token.get(pool.token0_id),
			context.Token.get(pool.token1_id),
		]);

		return [pool, ...res];
	},

	handler: async ({ event, context, loaderReturn }) => {
		if (!loaderReturn) return;

		for (const entity of loaderReturn) {
			if (!entity) return;
		}

		let [pool, bundle, token0, token1] = loaderReturn as [
			Pool,
			Bundle,
			Token,
			Token,
		];

		const {
			stablecoinWrappedNativePoolId,
			stablecoinIsToken0,
			wrappedNativeAddress,
			stablecoinAddresses,
			minimumNativeLocked,
		} = CHAIN_CONFIGS[event.chainId];

		// update pool sqrt price and tick
		pool = {
			...pool,
			sqrtPrice: event.params.sqrtPriceX96,
			tick: event.params.tick,
		};

		context.Pool.set(pool);

		// update ETH price now that prices could have changed
		bundle = {
			...bundle,
			ethPriceUsd: await getNativePriceInUSD(
				context,
				event.chainId,
				stablecoinWrappedNativePoolId,
				stablecoinIsToken0,
			),
		};

		context.Bundle.set(bundle);

		updatePoolDayData(event.block.timestamp, pool, context);
		updatePoolHourData(event.block.timestamp, pool, context);

		// update token prices
		const [derivedETH_t0, derivedETH_t1] = await Promise.all([
			findNativePerToken(
				context,
				token0,
				bundle,
				wrappedNativeAddress,
				stablecoinAddresses,
				minimumNativeLocked,
			),
			findNativePerToken(
				context,
				token1,
				bundle,
				wrappedNativeAddress,
				stablecoinAddresses,
				minimumNativeLocked,
			),
		]);

		token0 = {
			...token0,
			derivedEth: derivedETH_t0,
		};

		token1 = {
			...token1,
			derivedEth: derivedETH_t1,
		};

		context.Token.set(token0);
		context.Token.set(token1);
	},
});
