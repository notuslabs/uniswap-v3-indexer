import {
	UniswapV3Pool,
	type Token,
	type Pool,
	type Bundle,
	type Factory,
	BigDecimal,
} from "generated";
import { CHAIN_CONFIGS } from "./utils/chains";
import { ONE_BI, ZERO_BD } from "./utils/constants";
import { convertTokenToDecimal, safeDiv } from "./utils/index";
import * as pricing from "./utils/pricing";
import * as intervalUpdates from "./utils/intervalUpdates";

UniswapV3Pool.Swap.handlerWithLoader({
	loader: async ({ event, context }) => {
		const { factoryAddress } = CHAIN_CONFIGS[event.chainId];
		const poolId = `${event.chainId}-${event.srcAddress.toLowerCase()}`;
		const pool = await context.Pool.get(poolId);
		if (!pool) return;

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

		const [poolRO, bundleRO, factoryRO, token0RO, token1RO] = loaderReturn as [
			Pool,
			Bundle,
			Factory,
			Token,
			Token,
		];

		const factory = { ...factoryRO };
		const pool = { ...poolRO };
		const bundle = { ...bundleRO };
		const token0 = { ...token0RO };
		const token1 = { ...token1RO };
		const timestamp = event.block.timestamp;

		const {
			stablecoinWrappedNativePoolId,
			stablecoinIsToken0,
			wrappedNativeAddress,
			stablecoinAddresses,
			minimumNativeLocked,
			whitelistTokens,
			nativeTokenDetails,
		} = CHAIN_CONFIGS[event.chainId];

		// hot fix for bad pricing
		if (
			pool.id === `${event.chainId}-0x9663f2ca0454accad3e094448ea6f77443880454`
		) {
			return;
		}

		// amounts - 0/1 are token deltas: can be positive or negative
		const amount0 = convertTokenToDecimal(
			event.params.amount0,
			token0.decimals,
		);
		const amount1 = convertTokenToDecimal(
			event.params.amount1,
			token1.decimals,
		);

		// need absolute amounts for volume
		const amount0Abs = amount0.lt(ZERO_BD)
			? amount0.times(new BigDecimal("-1"))
			: amount0;
		const amount1Abs = amount1.lt(ZERO_BD)
			? amount1.times(new BigDecimal("-1"))
			: amount1;

		const amount0Eth = amount0Abs.times(token0.derivedEth);
		const amount1Eth = amount1Abs.times(token1.derivedEth);
		const amount0Usd = amount0Eth.times(bundle.ethPriceUsd);
		const amount1Usd = amount1Eth.times(bundle.ethPriceUsd);

		// get amount that should be tracked only - div 2 because cant count both input and output as volume
		const amountTotalUSDTracked = pricing
			.getTrackedAmountUSD(
				bundle,
				amount0Abs,
				token0 as Token,
				amount1Abs,
				token1 as Token,
				whitelistTokens,
			)
			.div(new BigDecimal("2"));

		const amountTotalETHTracked = safeDiv(
			amountTotalUSDTracked,
			bundle.ethPriceUsd,
		);
		const amountTotalUSDUntracked = amount0Usd
			.plus(amount1Usd)
			.div(new BigDecimal("2"));

		const scaler = new BigDecimal(pool.feeTier.toString()).div(
			new BigDecimal("1000000"),
		);
		const feesETH = amountTotalETHTracked.times(scaler);
		const feesUSD = amountTotalUSDTracked.times(scaler);

		// global updates
		factory.txCount = factory.txCount + ONE_BI;
		factory.numberOfSwaps = factory.numberOfSwaps + ONE_BI;
		factory.totalVolumeEth = factory.totalVolumeEth.plus(amountTotalETHTracked);
		factory.totalVolumeUsd = factory.totalVolumeUsd.plus(amountTotalUSDTracked);
		factory.untrackedVolumeUsd = factory.untrackedVolumeUsd.plus(
			amountTotalUSDUntracked,
		);
		factory.totalFeesEth = factory.totalFeesEth.plus(feesETH);
		factory.totalFeesUsd = factory.totalFeesUsd.plus(feesUSD);

		// reset aggregate tvl before individual pool tvl updates
		factory.totalValueLockedEth = factory.totalValueLockedEth.minus(
			pool.totalValueLockedEth,
		);

		// pool volume
		pool.volumeToken0 = pool.volumeToken0.plus(amount0Abs);
		pool.volumeToken1 = pool.volumeToken1.plus(amount1Abs);
		pool.volumeUsd = pool.volumeUsd.plus(amountTotalUSDTracked);
		pool.untrackedVolumeUsd = pool.untrackedVolumeUsd.plus(
			amountTotalUSDUntracked,
		);
		pool.feesUsd = pool.feesUsd.plus(feesUSD);
		pool.txCount = pool.txCount + ONE_BI;

		// Update the pool with the new active liquidity, price, and tick.
		pool.liquidity = event.params.liquidity;
		pool.tick = event.params.tick;
		pool.sqrtPrice = event.params.sqrtPriceX96;
		pool.totalValueLockedToken0 = pool.totalValueLockedToken0.plus(amount0);
		pool.totalValueLockedToken1 = pool.totalValueLockedToken1.plus(amount1);

		// update token0 data
		token0.volume = token0.volume.plus(amount0Abs);
		token0.totalValueLocked = token0.totalValueLocked.plus(amount0);
		token0.volumeUsd = token0.volumeUsd.plus(amountTotalUSDTracked);
		token0.untrackedVolumeUsd = token0.untrackedVolumeUsd.plus(
			amountTotalUSDUntracked,
		);
		token0.feesUsd = token0.feesUsd.plus(feesUSD);
		token0.txCount = token0.txCount + ONE_BI;

		// update token1 data
		token1.volume = token1.volume.plus(amount1Abs);
		token1.totalValueLocked = token1.totalValueLocked.plus(amount1);
		token1.volumeUsd = token1.volumeUsd.plus(amountTotalUSDTracked);
		token1.untrackedVolumeUsd = token1.untrackedVolumeUsd.plus(
			amountTotalUSDUntracked,
		);
		token1.feesUsd = token1.feesUsd.plus(feesUSD);
		token1.txCount = token1.txCount + ONE_BI;

		// updated pool ratess
		const prices = pricing.sqrtPriceX96ToTokenPrices(
			pool.sqrtPrice,
			token0,
			token1,
			nativeTokenDetails,
		);
		pool.token0Price = prices[0];
		pool.token1Price = prices[1];
		context.Pool.set(pool);

		// update USD pricing
		bundle.ethPriceUsd = await pricing.getNativePriceInUSD(
			context,
			event.chainId,
			stablecoinWrappedNativePoolId,
			stablecoinIsToken0,
		);

		context.Bundle.set(bundle);

		token0.derivedEth = await pricing.findNativePerToken(
			context,
			token0,
			bundle,
			wrappedNativeAddress,
			stablecoinAddresses,
			minimumNativeLocked,
		);
		token1.derivedEth = await pricing.findNativePerToken(
			context,
			token1,
			bundle,
			wrappedNativeAddress,
			stablecoinAddresses,
			minimumNativeLocked,
		);

		/**
		 * Things afffected by new USD rates
		 */
		pool.totalValueLockedEth = pool.totalValueLockedToken0
			.times(token0.derivedEth)
			.plus(pool.totalValueLockedToken1.times(token1.derivedEth));
		pool.totalValueLockedUsd = pool.totalValueLockedEth.times(
			bundle.ethPriceUsd,
		);

		factory.totalValueLockedEth = factory.totalValueLockedEth.plus(
			pool.totalValueLockedEth,
		);
		factory.totalValueLockedUsd = factory.totalValueLockedEth.times(
			bundle.ethPriceUsd,
		);

		token0.totalValueLockedUsd = token0.totalValueLocked
			.times(token0.derivedEth)
			.times(bundle.ethPriceUsd);
		token1.totalValueLockedUsd = token1.totalValueLocked
			.times(token1.derivedEth)
			.times(bundle.ethPriceUsd);

		const poolDayData = {
			...(await intervalUpdates.updatePoolDayData(timestamp, pool, context)),
		};
		const poolHourData = {
			...(await intervalUpdates.updatePoolHourData(timestamp, pool, context)),
		};

		poolDayData.volumeUsd = poolDayData.volumeUsd.plus(amountTotalUSDTracked);
		poolDayData.volumeToken0 = poolDayData.volumeToken0.plus(amount0Abs);
		poolDayData.volumeToken1 = poolDayData.volumeToken1.plus(amount1Abs);
		poolDayData.feesUsd = poolDayData.feesUsd.plus(feesUSD);

		poolHourData.volumeUsd = poolHourData.volumeUsd.plus(amountTotalUSDTracked);
		poolHourData.volumeToken0 = poolHourData.volumeToken0.plus(amount0Abs);
		poolHourData.volumeToken1 = poolHourData.volumeToken1.plus(amount1Abs);
		poolHourData.feesUsd = poolHourData.feesUsd.plus(feesUSD);

		context.PoolDayData.set(poolDayData);
		context.PoolHourData.set(poolHourData);
		context.Factory.set(factory);
		context.Pool.set(pool);
		context.Token.set(token0);
		context.Token.set(token1);
	},
});
