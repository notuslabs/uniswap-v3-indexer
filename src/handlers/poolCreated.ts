import { UniswapV3Factory, Bundle, Token, Pool } from "generated";
import { ZERO_BD, ZERO_BI, ONE_BI, ADDRESS_ZERO } from "./utils/constants";
import { CHAIN_CONFIGS } from "./utils/chains";
import { isAddressInList } from "./utils/index";
import { getTokenMetadata } from "./utils/tokenMetadata";

UniswapV3Factory.PoolCreated.contractRegister(({ event, context }) => {
  context.addUniswapV3Pool(event.params.pool);
});

UniswapV3Factory.PoolCreated.handlerWithLoader({
  loader: async ({ event, context }) => {
    const { factoryAddress } = CHAIN_CONFIGS[event.chainId];

    return Promise.all([
      context.Factory.get(`${event.chainId}-${factoryAddress.toLowerCase()}`),
      context.Token.get(
        `${event.chainId}-${event.params.token0.toLowerCase()}`
      ),
      context.Token.get(
        `${event.chainId}-${event.params.token1.toLowerCase()}`
      ),
    ]);
  },

  handler: async ({ event, context, loaderReturn }) => {
    const { factoryAddress, poolsToSkip } = CHAIN_CONFIGS[event.chainId];

    // temp fix
    if (isAddressInList(event.params.pool, poolsToSkip)) {
      return;
    }

    const [factoryRO, token0RO, token1RO] = loaderReturn;
    let factory;

    if (factoryRO) {
      factory = { ...factoryRO };
    } else {
      factory = {
        id: `${event.chainId}-${factoryAddress.toLowerCase()}`,
        poolCount: ZERO_BI,
        numberOfSwaps: ZERO_BI,
        totalVolumeETH: ZERO_BD,
        totalVolumeUSD: ZERO_BD,
        untrackedVolumeUSD: ZERO_BD,
        totalFeesUSD: ZERO_BD,
        totalFeesETH: ZERO_BD,
        totalValueLockedETH: ZERO_BD,
        totalValueLockedUSD: ZERO_BD,
        totalValueLockedUSDUntracked: ZERO_BD,
        totalValueLockedETHUntracked: ZERO_BD,
        txCount: ZERO_BI,
        owner: ADDRESS_ZERO,
      };

      // create new bundle for tracking eth price
      const bundle: Bundle = {
        id: event.chainId.toString(),
        ethPriceUSD: ZERO_BD,
      };

      context.Bundle.set(bundle);
    }

    factory.poolCount = factory.poolCount + ONE_BI;
    const tokens = [];

    try {
      const arr = [];

      if (token0RO) {
        tokens[0] = { ...token0RO };
      } else {
        arr.push(
          getToken(event.params.token0, event.chainId).then(
            (token) => (tokens[0] = token)
          )
        );
      }

      if (token1RO) {
        tokens[1] = { ...token1RO };
      } else {
        arr.push(
          getToken(event.params.token1, event.chainId).then(
            (token) => (tokens[1] = token)
          )
        );
      }

      if (arr.length) {
        await Promise.all(arr);
      }
    } catch (err) {
      console.error("Error loading tokens", err);
      return;
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
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      txCount: ZERO_BI,
      collectedFeesToken0: ZERO_BD,
      collectedFeesToken1: ZERO_BD,
      collectedFeesUSD: ZERO_BD,
      totalValueLockedToken0: ZERO_BD,
      totalValueLockedToken1: ZERO_BD,
      totalValueLockedETH: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      liquidityProviderCount: ZERO_BI,
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

async function getToken(id: string, chainId: number): Promise<Token> {
  const { whitelistTokens } = CHAIN_CONFIGS[chainId];
  const tokenMetadata = await getTokenMetadata(id, chainId);

  return {
    id: `${chainId}-${id.toLowerCase()}`,
    symbol: tokenMetadata.symbol,
    name: tokenMetadata.name,
    decimals: BigInt(tokenMetadata.decimals),
    isWhitelisted: isAddressInList(id, whitelistTokens),
    volume: ZERO_BD,
    volumeUSD: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
    txCount: ZERO_BI,
    poolCount: ZERO_BI,
    totalValueLocked: ZERO_BD,
    totalValueLockedUSD: ZERO_BD,
    totalValueLockedUSDUntracked: ZERO_BD,
    derivedETH: ZERO_BD,
    whitelistPools: [],
  };
}
