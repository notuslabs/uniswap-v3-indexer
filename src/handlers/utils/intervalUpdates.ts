import { ONE_BI, ZERO_BD, ZERO_BI } from "./constants";
import type {
	handlerContext,
	Pool,
	PoolDayData,
	PoolHourData,
} from "generated";

export async function updatePoolDayData(
	timestamp: number,
	pool: Pool,
	context: handlerContext,
): Promise<PoolDayData> {
	const dayID = Math.floor(timestamp / 86400);
	const dayStartTimestamp = dayID * 86400;
	const dayPoolID = `${pool.id}-${dayID}`;
	const poolDayDataRO = await context.PoolDayData.get(dayPoolID);
	const poolDayData = poolDayDataRO
		? { ...poolDayDataRO }
		: {
				id: dayPoolID,
				date: dayStartTimestamp,
				pool_id: pool.id,
				// things that dont get initialized always
				volumeToken0: ZERO_BD,
				volumeToken1: ZERO_BD,
				volumeUSD: ZERO_BD,
				feesUSD: ZERO_BD,
				txCount: ZERO_BI,
				openingPrice: pool.token0Price,
				high: pool.token0Price,
				low: pool.token0Price,
				close: pool.token0Price,

				liquidity: pool.liquidity,
				sqrtPrice: pool.sqrtPrice,
				token0Price: pool.token0Price,
				token1Price: pool.token1Price,
				tick: pool.tick,
				tvlUSD: pool.totalValueLockedUSD,
			};

	if (pool.token0Price.gt(poolDayData.high)) {
		poolDayData.high = pool.token0Price;
	}

	if (pool.token0Price.lt(poolDayData.low)) {
		poolDayData.low = pool.token0Price;
	}

	poolDayData.liquidity = pool.liquidity;
	poolDayData.sqrtPrice = pool.sqrtPrice;
	poolDayData.token0Price = pool.token0Price;
	poolDayData.token1Price = pool.token1Price;
	poolDayData.close = pool.token0Price;
	poolDayData.tick = pool.tick;
	poolDayData.tvlUSD = pool.totalValueLockedUSD;
	poolDayData.txCount = poolDayData.txCount + ONE_BI;

	context.PoolDayData.set(poolDayData);
	return poolDayData as PoolDayData;
}

export async function updatePoolHourData(
	timestamp: number,
	pool: Pool,
	context: handlerContext,
): Promise<PoolHourData> {
	const hourIndex = Math.floor(timestamp / 3600); // get unique hour within unix history
	const hourStartUnix = hourIndex * 3600; // want the rounded effect
	const hourPoolID = `${pool.id}-${hourIndex}`;
	let temp = await context.PoolHourData.get(hourPoolID);

	if (!temp) {
		temp = {
			id: hourPoolID,
			periodStartUnix: hourStartUnix,
			pool_id: pool.id,
			// things that dont get initialized always
			volumeToken0: ZERO_BD,
			volumeToken1: ZERO_BD,
			volumeUSD: ZERO_BD,
			txCount: ZERO_BI,
			feesUSD: ZERO_BD,
			openingPrice: pool.token0Price,
			high: pool.token0Price,
			low: pool.token0Price,
			close: pool.token0Price,

			liquidity: ZERO_BI,
			sqrtPrice: ZERO_BI,
			token0Price: ZERO_BD,
			token1Price: ZERO_BD,
			tick: undefined,
			tvlUSD: ZERO_BD,
		};
	}

	const poolHourData = { ...temp };

	if (pool.token0Price.gt(poolHourData.high)) {
		poolHourData.high = pool.token0Price;
	}

	if (pool.token0Price.lt(poolHourData.low)) {
		poolHourData.low = pool.token0Price;
	}

	poolHourData.liquidity = pool.liquidity;
	poolHourData.sqrtPrice = pool.sqrtPrice;
	poolHourData.token0Price = pool.token0Price;
	poolHourData.token1Price = pool.token1Price;
	poolHourData.close = pool.token0Price;
	poolHourData.tick = pool.tick;
	poolHourData.tvlUSD = pool.totalValueLockedUSD;
	poolHourData.txCount = poolHourData.txCount + ONE_BI;

	context.PoolHourData.set(poolHourData);
	// test
	return poolHourData as PoolHourData;
}
