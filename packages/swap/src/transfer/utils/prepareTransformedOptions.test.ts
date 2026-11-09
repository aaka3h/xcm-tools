import type { TAssetInfo } from '@paraspell/sdk-core';
import type { PolkadotApi } from '@paraspell/sdk-core';
import {
  createChainClient,
  findAssetInfo,
  getSupportedAssetsImpl,
  UnsupportedOperationError,
} from '@paraspell/sdk-core';
import { AccountId } from 'polkadot-api';
import { toHex } from 'polkadot-api/utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  getExchangeAsset,
  getExchangeAssetByOriginAsset,
  supportsExchangePair,
} from '../../assets';
import type ExchangeChain from '../../exchanges/ExchangeChain';
import { createExchangeInstance } from '../../exchanges/ExchangeChainFactory';
import type { TTransferBaseOptions } from '../../types';
import { selectBestExchange } from '../selectBestExchange';
import { prepareTransformedOptions } from './prepareTransformedOptions';
import { determineFeeCalcAddress } from './utils';

const mockApiForChain = { api: {} };
const mockApi = {
  createApiForChain: vi.fn().mockResolvedValue(mockApiForChain),
  config: undefined,
  accountToHex: (address: string) => toHex(AccountId().enc(address)),
} as unknown as PolkadotApi<unknown, unknown, unknown>;

vi.mock('../../exchanges/ExchangeChainFactory');
vi.mock('../selectBestExchange');
vi.mock('./utils');
vi.mock('../../assets');

vi.mock('@paraspell/sdk-core', async (importActual) => ({
  ...(await importActual()),
  createChainClient: vi.fn(),
  findAssetInfo: vi.fn(),
  getSupportedAssetsImpl: vi.fn(),
  applyDecimalAbstraction: vi.fn(),
}));

describe('prepareTransformedOptions', () => {
  const acaAsset: TAssetInfo = {
    symbol: 'ACA',
    decimals: 8,
    existentialDeposit: '1000',
    location: {
      parents: 1,
      interior: 'Here',
    },
  };

  const astrAsset: TAssetInfo = {
    symbol: 'ASTR',
    decimals: 8,
    existentialDeposit: '1000',
    location: {
      parents: 2,
      interior: 'Here',
    },
  };

  beforeEach(() => {
    vi.mocked(getSupportedAssetsImpl).mockReturnValue([]);
  });

  describe('local swap recipients', () => {
    const sender = AccountId().dec(new Uint8Array(32).fill(1));
    const recipient = AccountId().dec(new Uint8Array(32).fill(2));
    const localOptions = {
      api: mockApi,
      from: 'AssetHubPolkadot',
      to: 'AssetHubPolkadot',
      exchange: 'AssetHubPolkadot',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
      amount: 1000n,
      slippagePct: '1',
      sender,
      recipient,
    } as const;

    beforeEach(() => {
      const dex = { chain: 'AssetHubPolkadot', apiType: 'GENERIC' } as ExchangeChain;
      vi.mocked(createExchangeInstance).mockReturnValue(dex);
      vi.mocked(selectBestExchange).mockResolvedValue(dex);
      vi.mocked(getExchangeAsset).mockImplementation((_chain, currency) =>
        'symbol' in currency && currency.symbol === 'ACA' ? acaAsset : astrAsset,
      );
      vi.mocked(getExchangeAssetByOriginAsset).mockReturnValue(acaAsset);
      vi.mocked(findAssetInfo).mockReturnValue(acaAsset);
      vi.mocked(getSupportedAssetsImpl).mockReturnValue([astrAsset]);
      vi.mocked(supportsExchangePair).mockReturnValue(true);
    });

    afterEach(() => {
      vi.mocked(getExchangeAsset).mockReset();
    });

    test.each([
      { label: 'explicit exchange', exchange: 'AssetHubPolkadot' as const },
      { label: 'automatic exchange', exchange: undefined },
      { label: 'exchange candidates', exchange: ['AssetHubPolkadot'] as ['AssetHubPolkadot'] },
    ])('rejects a different recipient with $label', async ({ exchange }) => {
      await expect(prepareTransformedOptions({ ...localOptions, exchange })).rejects.toThrow(
        UnsupportedOperationError,
      );
    });

    test('rejects a different recipient when local origin and destination are omitted', async () => {
      await expect(
        prepareTransformedOptions({ ...localOptions, from: undefined, to: undefined }),
      ).rejects.toThrow(UnsupportedOperationError);
    });

    test('allows the sender as recipient with another SS58 prefix', async () => {
      const recipient = AccountId(0).dec(AccountId().enc(sender));
      expect(recipient).not.toBe(sender);
      const result = await prepareTransformedOptions({ ...localOptions, recipient });
      expect(result.options.origin).toBeUndefined();
      expect(result.options.destination).toBeUndefined();
    });

    test('allows a local swap without a recipient', async () => {
      const result = await prepareTransformedOptions({ ...localOptions, recipient: undefined });
      expect(result.options.destination).toBeUndefined();
    });

    test('retains a different recipient when the swap routes back to another chain', async () => {
      const result = await prepareTransformedOptions({
        ...localOptions,
        from: 'Hydration',
        to: 'Hydration',
      });
      expect(result.options.destination).toEqual({ chain: 'Hydration', address: recipient });
    });
  });

  test('calls selectBestExchange if exchange is undefined', async () => {
    const mockOptions = {
      from: 'Acala',
      to: 'Astar',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
    } as TTransferBaseOptions<unknown, unknown, unknown>;

    const mockDexChain = {
      chain: 'Acala',
      createApiInstance: vi.fn(),
      createApiInstancePapi: vi.fn(),
    } as unknown as ExchangeChain;

    vi.mocked(selectBestExchange).mockResolvedValue(mockDexChain);
    vi.mocked(supportsExchangePair).mockReturnValue(true);

    await expect(prepareTransformedOptions({ ...mockOptions, api: mockApi })).rejects.toThrow();

    expect(selectBestExchange).toHaveBeenCalledWith({ ...mockOptions, api: mockApi }, {}, false);
  });

  test('throws error when origin asset is not found', async () => {
    const mockOptions = {
      from: 'Acala',
      to: 'Astar',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
      exchange: 'Acala',
    } as TTransferBaseOptions<unknown, unknown, unknown>;

    const mockDexChain = {
      chain: 'Acala',
    } as ExchangeChain;

    vi.mocked(createExchangeInstance).mockReturnValue(mockDexChain);
    vi.mocked(findAssetInfo).mockReturnValue(null);
    vi.mocked(supportsExchangePair).mockReturnValue(true);

    await expect(prepareTransformedOptions({ ...mockOptions, api: mockApi })).rejects.toThrow(
      `Currency from ${JSON.stringify(mockOptions.currencyFrom)} not found in ${mockOptions.exchange?.toString()}.`,
    );
  });

  test('throws error when exchange assetFrom is not found', async () => {
    const mockOptions = {
      from: 'Acala',
      to: 'Astar',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
      exchange: 'Acala',
    } as TTransferBaseOptions<unknown, unknown, unknown>;

    const mockDexChain = {
      chain: 'Acala',
    } as ExchangeChain;

    vi.mocked(createExchangeInstance).mockReturnValue(mockDexChain);
    vi.mocked(findAssetInfo).mockReturnValue(null);
    vi.mocked(getExchangeAssetByOriginAsset).mockReturnValue(undefined);
    vi.mocked(supportsExchangePair).mockReturnValue(true);

    await expect(prepareTransformedOptions({ ...mockOptions, api: mockApi })).rejects.toThrow(
      `Currency from ${JSON.stringify(mockOptions.currencyFrom)} not found in ${mockDexChain.chain}.`,
    );
  });

  test('throws error when exchange assetTo is not found', async () => {
    const mockOptions = {
      from: 'Hydration',
      to: 'Astar',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
      exchange: 'Acala',
    } as TTransferBaseOptions<unknown, unknown, unknown>;

    const mockDexChain = {
      chain: 'Acala',
    } as ExchangeChain;

    vi.mocked(createExchangeInstance).mockReturnValue(mockDexChain);
    vi.mocked(findAssetInfo).mockReturnValue({ symbol: 'ACA' } as TAssetInfo);
    vi.mocked(getExchangeAssetByOriginAsset).mockReturnValue(acaAsset);
    vi.mocked(getExchangeAsset).mockReturnValue(null);
    vi.mocked(supportsExchangePair).mockReturnValue(true);

    await expect(prepareTransformedOptions({ ...mockOptions, api: mockApi })).rejects.toThrow(
      `Currency to ${JSON.stringify(mockOptions.currencyTo)} not found in ${mockDexChain.chain}.`,
    );
  });

  test('throws error when destination does not support assetTo', async () => {
    const mockOptions = {
      from: 'Acala',
      to: 'Astar',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
      exchange: 'Acala',
    } as TTransferBaseOptions<unknown, unknown, unknown>;

    const mockDexChain = {
      chain: 'Acala',
    } as ExchangeChain;

    vi.mocked(createExchangeInstance).mockReturnValue(mockDexChain);
    vi.mocked(findAssetInfo).mockReturnValue(null);
    vi.mocked(getExchangeAssetByOriginAsset).mockReturnValue(acaAsset);
    vi.mocked(getExchangeAsset).mockReturnValue(astrAsset);
    vi.mocked(supportsExchangePair).mockReturnValue(true);

    await expect(prepareTransformedOptions({ ...mockOptions, api: mockApi })).rejects.toThrow(
      `Currency to ${JSON.stringify(mockOptions.currencyTo)} not supported by ${mockOptions.to}.`,
    );
  });

  test('returns correctly transformed options when all assets are found', async () => {
    const mockOptions = {
      from: 'Hydration',
      to: 'Astar',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
      exchange: 'Acala',
      sender: 'senderAddr',
      recipient: 'recipientAddr',
    } as TTransferBaseOptions<unknown, unknown, unknown>;

    const mockDexChain = {
      chain: 'Acala',
      apiType: 'PJS',
      createApiInstance: vi.fn().mockResolvedValue({}),
      createApiInstancePapi: vi.fn().mockResolvedValue({}),
    } as unknown as ExchangeChain;

    const mockOriginAsset = { symbol: 'ACA', decimals: 8 } as TAssetInfo;

    vi.mocked(createExchangeInstance).mockReturnValue(mockDexChain);
    vi.mocked(findAssetInfo).mockReturnValue(mockOriginAsset);
    vi.mocked(getExchangeAssetByOriginAsset).mockReturnValue(acaAsset);
    vi.mocked(getExchangeAsset).mockReturnValue(astrAsset);
    vi.mocked(createChainClient).mockResolvedValue({});
    vi.mocked(supportsExchangePair).mockReturnValue(true);
    vi.mocked(getSupportedAssetsImpl).mockReturnValue([astrAsset]);
    vi.mocked(determineFeeCalcAddress).mockReturnValue('feeCalcAddr');

    const result = await prepareTransformedOptions({ ...mockOptions, api: mockApi });

    expect(result.dex).toBe(mockDexChain);
    expect(result.options.origin).toEqual({
      api: expect.any(Object),
      chain: mockOptions.from,
      assetFrom: mockOriginAsset,
    });
    expect(result.options.exchange).toEqual({
      apiType: 'PJS',
      apiPjs: expect.any(Object),
      api: expect.anything(),
      chain: mockDexChain.chain,
      assetFrom: acaAsset,
      assetTo: astrAsset,
      feeAssetInfo: undefined,
    });
    expect(result.options.feeCalcAddress).toBe('feeCalcAddr');
  });

  test('throws error when exchange does not support the asset pair', async () => {
    const mockOptions = {
      from: 'Acala',
      to: 'Astar',
      currencyFrom: { symbol: 'ACA' },
      currencyTo: { symbol: 'ASTR' },
      exchange: 'Acala',
    } as TTransferBaseOptions<unknown, unknown, unknown>;

    const mockDexChain = {
      chain: 'Acala',
    } as ExchangeChain;

    vi.mocked(createExchangeInstance).mockReturnValue(mockDexChain);
    vi.mocked(findAssetInfo).mockReturnValue(acaAsset);
    vi.mocked(getExchangeAssetByOriginAsset).mockReturnValue(acaAsset);
    vi.mocked(getExchangeAsset).mockReturnValue(astrAsset);
    vi.mocked(getSupportedAssetsImpl).mockReturnValue([astrAsset]);
    vi.mocked(supportsExchangePair).mockReturnValue(false);

    await expect(prepareTransformedOptions({ ...mockOptions, api: mockApi })).rejects.toThrow(
      `Exchange ${mockDexChain.chain} does not support the pair ASTR -> ASTR`,
    );
  });
});
