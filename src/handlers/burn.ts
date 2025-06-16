import {
	UniswapV3Pool,
	type Token,
	type Pool,
	type Bundle,
	type Factory,
	type Tick,
} from "generated";
import { CHAIN_CONFIGS } from "./utils/chains";
import { ONE_BI } from "./utils/constants";
import * as intervalUpdates from "./utils/intervalUpdates";

UniswapV3Pool.Burn.handlerWithLoader({
	loader: async ({ event, context }) => {
		const { factoryAddress } = CHAIN_CONFIGS[event.chainId];
		const poolId = `${event.chainId}-${event.srcAddress.toLowerCase()}`;
		const pool = await context.Pool.get(poolId);
		if (!pool) return;

		// tick entities
		const lowerTickId = `${poolId}#${event.params.tickLower}`;
		const upperTickId = `${poolId}#${event.params.tickUpper}`;

		const res = await Promise.all([
			context.Bundle.get(event.chainId.toString()),
			context.Factory.get(`${event.chainId}-${factoryAddress.toLowerCase()}`),
			context.Token.get(pool.token0_id),
			context.Token.get(pool.token1_id),

			context.Tick.get(lowerTickId),
			context.Tick.get(upperTickId),
		]);

		return [pool, ...res];
	},

	handler: async ({ event, context, loaderReturn }) => {
		if (!loaderReturn) return;
		const [lowerTickRO, upperTickRO] = loaderReturn.splice(5) as Tick[];

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
		const timestamp = event.block.timestamp;

		factory.txCount = factory.txCount + ONE_BI;
		token0.txCount = token0.txCount + ONE_BI;
		token1.txCount = token1.txCount + ONE_BI;
		pool.txCount = pool.txCount + ONE_BI;

		// Pools liquidity tracks the currently active liquidity given pools current tick.
		// We only want to update it on burn if the position being burnt includes the current tick.
		if (
			typeof pool.tick === "bigint" &&
			event.params.tickLower <= pool.tick &&
			event.params.tickUpper > pool.tick
		) {
			// todo: this liquidity can be calculated from the real reserves and
			// current price instead of incrementally from every burned amount which
			// may not be accurate: https://linear.app/uniswap/issue/DAT-336/fix-pool-liquidity
			pool.liquidity = pool.liquidity - event.params.amount;
		}

		if (lowerTickRO && upperTickRO) {
			const amount = event.params.amount;
			const lowerTick = { ...lowerTickRO };
			const upperTick = { ...upperTickRO };

			lowerTick.liquidityGross = lowerTick.liquidityGross - amount;
			lowerTick.liquidityNet = lowerTick.liquidityNet - amount;
			upperTick.liquidityGross = upperTick.liquidityGross - amount;
			upperTick.liquidityNet = upperTick.liquidityNet - amount;

			context.Tick.set(lowerTick);
			context.Tick.set(upperTick);
		}

		intervalUpdates.updatePoolDayData(timestamp, pool, context);
		intervalUpdates.updatePoolHourData(timestamp, pool, context);

		context.Token.set(token0);
		context.Token.set(token1);
		context.Pool.set(pool);
		context.Factory.set(factory);
	},
});
