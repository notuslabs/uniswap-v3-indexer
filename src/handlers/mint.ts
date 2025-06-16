import {
	UniswapV3Pool,
	type Token,
	type Pool,
	type Bundle,
	type Factory,
	type Tick,
	BigDecimal,
} from "generated";
import {
	convertTokenToDecimal,
	fastExponentiation,
	safeDiv,
} from "./utils/index";
import { ONE_BI, ZERO_BI, ONE_BD } from "./utils/constants";
import { CHAIN_CONFIGS } from "./utils/chains";
import * as intervalUpdates from "./utils/intervalUpdates";

UniswapV3Pool.Mint.handlerWithLoader({
	loader: async ({ event, context }) => {
		const { factoryAddress } = CHAIN_CONFIGS[event.chainId];
		const poolId = `${event.chainId}-${event.srcAddress.toLowerCase()}`;
		const pool = await context.Pool.get(poolId);
		if (!pool) return;

		// tick entities
		const factoryId = `${event.chainId}-${factoryAddress.toLowerCase()}`;
		const lowerTickId = `${poolId}#${event.params.tickLower}`;
		const upperTickId = `${poolId}#${event.params.tickUpper}`;

		const res = await Promise.all([
			context.Bundle.get(event.chainId.toString()),
			context.Factory.get(factoryId),
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

		const amount0 = convertTokenToDecimal(
			event.params.amount0,
			token0.decimals,
		);
		const amount1 = convertTokenToDecimal(
			event.params.amount1,
			token1.decimals,
		);

		// reset tvl aggregates until new amounts calculated
		factory.totalValueLockedETH = factory.totalValueLockedETH.minus(
			pool.totalValueLockedETH,
		);

		// update globals
		factory.txCount = factory.txCount + ONE_BI;

		// update token0 data
		token0.txCount = token0.txCount + ONE_BI;
		token0.totalValueLocked = token0.totalValueLocked.plus(amount0);
		token0.totalValueLockedUSD = token0.totalValueLocked.times(
			token0.derivedETH.times(bundle.ethPriceUSD),
		);

		// update token1 data
		token1.txCount = token1.txCount + ONE_BI;
		token1.totalValueLocked = token1.totalValueLocked.plus(amount1);
		token1.totalValueLockedUSD = token1.totalValueLocked.times(
			token1.derivedETH.times(bundle.ethPriceUSD),
		);

		// pool data
		pool.txCount = pool.txCount + ONE_BI;

		// Pools liquidity tracks the currently active liquidity given pools current tick.
		// We only want to update it on mint if the new position includes the current tick.
		if (
			typeof pool.tick === "bigint" &&
			event.params.tickLower <= pool.tick &&
			event.params.tickUpper > pool.tick
		) {
			pool.liquidity = pool.liquidity + event.params.amount;
		}

		pool.totalValueLockedToken0 = pool.totalValueLockedToken0.plus(amount0);
		pool.totalValueLockedToken1 = pool.totalValueLockedToken1.plus(amount1);
		pool.totalValueLockedETH = pool.totalValueLockedToken0
			.times(token0.derivedETH)
			.plus(pool.totalValueLockedToken1.times(token1.derivedETH));
		pool.totalValueLockedUSD = pool.totalValueLockedETH.times(
			bundle.ethPriceUSD,
		);

		// reset aggregates with new amounts
		factory.totalValueLockedETH = factory.totalValueLockedETH.plus(
			pool.totalValueLockedETH,
		);
		factory.totalValueLockedUSD = factory.totalValueLockedETH.times(
			bundle.ethPriceUSD,
		);

		// tick entities
		const lowerTickIdx = event.params.tickLower;
		const upperTickIdx = event.params.tickUpper;
		const ltId = `${pool.id}#${lowerTickIdx}`;
		const utId = `${pool.id}#${upperTickIdx}`;
		const amount = event.params.amount;

		const lowerTick = lowerTickRO
			? { ...lowerTickRO }
			: {
					...createTick(
						ltId,
						lowerTickIdx,
						pool.id,
						timestamp,
						event.block.number,
					),
				};

		const upperTick = upperTickRO
			? { ...upperTickRO }
			: {
					...createTick(
						utId,
						upperTickIdx,
						pool.id,
						timestamp,
						event.block.number,
					),
				};

		lowerTick.liquidityGross = lowerTick.liquidityGross + amount;
		lowerTick.liquidityNet = lowerTick.liquidityNet + amount;
		upperTick.liquidityGross = upperTick.liquidityGross + amount;
		upperTick.liquidityNet = upperTick.liquidityNet - amount;

		context.Tick.set(lowerTick);
		context.Tick.set(upperTick);

		// TODO: Update Tick's volume, fees, and liquidity provider count. Computing these on the tick
		// level requires reimplementing some of the swapping code from v3-core.

		intervalUpdates.updatePoolDayData(timestamp, pool, context);
		intervalUpdates.updatePoolHourData(timestamp, pool, context);

		context.Token.set(token0);
		context.Token.set(token1);
		context.Pool.set(pool);
		context.Factory.set(factory);
	},
});

function createTick(
	tickId: string,
	tickIdx: bigint,
	poolId: string,
	timestamp: number,
	blockNumber: number,
): Tick {
	// 1.0001^tick is token1/token0.
	const Price0 = fastExponentiation(new BigDecimal("1.0001"), tickIdx);

	return {
		id: tickId,
		tickIdx: tickIdx,
		pool_id: poolId,
		poolAddress: poolId,

		createdAtTimestamp: BigInt(timestamp),
		createdAtBlockNumber: BigInt(blockNumber),
		liquidityGross: ZERO_BI,
		liquidityNet: ZERO_BI,

		price0: Price0,
		price1: safeDiv(ONE_BD, Price0),
	};
}
