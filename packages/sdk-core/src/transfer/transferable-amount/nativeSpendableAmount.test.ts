import type { TCurrencyInput } from '@paraspell/assets'
import { findAssetInfoOrThrow, findNativeAssetInfoOrThrow } from '@paraspell/assets'
import { Version } from '@paraspell/sdk-common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PolkadotApi } from '../../api'
import { getOriginXcmFee } from '../fees/getOriginXcmFee'
import { getTransferableAmountInternal } from './getTransferableAmount'

vi.mock('../fees/getOriginXcmFee', () => ({ getOriginXcmFee: vi.fn() }))

const native = {
  ...findNativeAssetInfoOrThrow('AssetHubPolkadot'),
  existentialDeposit: '100',
  decimals: 0
}
const foreign = {
  ...findAssetInfoOrThrow('AssetHubPolkadot', { id: '1337' }),
  existentialDeposit: '10',
  decimals: 0
}

const createOptions = (free: bigint, frozen = 0n, reserved = 0n) => {
  const resolveAsset = (_chain: string, currency: TCurrencyInput) =>
    'symbol' in currency && currency.symbol === 'DOT' ? native : foreign
  const queryState = vi.fn(({ module }: { module: string }) =>
    Promise.resolve(module === 'System' ? { data: { free, frozen, reserved } } : { balance: 500n })
  )
  const api = {
    _customCtx: {},
    config: { abstractDecimals: false },
    init: vi.fn(),
    isChainEvm: () => false,
    validateSubstrateAddress: () => true,
    getNativeAssetSymbol: () => 'DOT',
    findNativeAssetInfoOrThrow: () => native,
    findAssetInfo: resolveAsset,
    findAssetInfoOrThrow: resolveAsset,
    queryState
  } as unknown as PolkadotApi<unknown, unknown, unknown>
  return {
    api,
    queryState,
    origin: 'AssetHubPolkadot' as const,
    destination: 'AssetHubPolkadot' as const,
    sender: '0x' + '01'.repeat(32),
    currency: { symbol: 'DOT', amount: 1n },
    version: Version.V5,
    buildTx: vi.fn()
  }
}

describe('native transferable amount with real pallet balance reads', () => {
  beforeEach(() => {
    vi.mocked(getOriginXcmFee).mockResolvedValue({
      fee: 200n,
      feeType: 'paymentInfo',
      asset: native
    })
  })

  it.each([
    { free: 1000n, frozen: 0n, reserved: 0n, expected: 700n },
    { free: 1000n, frozen: 600n, reserved: 100n, expected: 300n },
    { free: 80n, frozen: 0n, reserved: 0n, expected: 0n },
    { free: 250n, frozen: 0n, reserved: 0n, expected: 0n },
    { free: 300n, frozen: 0n, reserved: 0n, expected: 0n }
  ])(
    'returns $expected for free=$free, frozen=$frozen, reserved=$reserved',
    async ({ free, frozen, reserved, expected }) => {
      const options = createOptions(free, frozen, reserved)
      expect(await getTransferableAmountInternal(options)).toBe(expected)
      expect(options.queryState).toHaveBeenCalledWith({
        module: 'System',
        method: 'Account',
        params: [options.sender]
      })
    }
  )

  it('still reserves the foreign asset minimum balance and its selected fee', async () => {
    vi.mocked(getOriginXcmFee).mockResolvedValue({
      fee: 200n,
      feeType: 'paymentInfo',
      asset: foreign
    })
    const options = createOptions(1000n)
    const result = await getTransferableAmountInternal({
      ...options,
      currency: { id: '1337', amount: 1n },
      feeAsset: { id: '1337' }
    })
    expect(result).toBe(290n)
    expect(options.queryState).toHaveBeenCalledWith({
      module: 'Assets',
      method: 'Account',
      params: [1337, options.sender]
    })
  })

  it('reserves each minimum once for a mixed native and foreign currency array', async () => {
    const options = createOptions(1000n)
    const result = await getTransferableAmountInternal({
      ...options,
      currency: [
        { symbol: 'DOT', amount: 1n },
        { id: '1337', amount: 1n }
      ],
      feeAsset: { symbol: 'DOT' }
    })
    expect(result).toEqual([700n, 490n])
  })
})
