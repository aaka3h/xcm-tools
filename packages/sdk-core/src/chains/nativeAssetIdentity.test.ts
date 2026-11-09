import {
  findAssetInfoOrThrow,
  findNativeAssetInfoOrThrow,
  getNativeAssetSymbol
} from '@paraspell/assets'
import { Version } from '@paraspell/sdk-common'
import { describe, expect, it, vi } from 'vitest'

import type { PolkadotApi } from '../api'
import { getAssetBalanceInternal } from '../balance'
import { isSufficientDestination, isSufficientOrigin } from '../transfer/fees/isSufficient'
import { getTransferableAmountInternal } from '../transfer/transferable-amount/getTransferableAmount'
import { getSubstrateChainImpl } from './getChainInstance'

vi.mock('../transfer/fees/getOriginXcmFee', () => ({ getOriginXcmFee: vi.fn() }))

const address = '0x' + '01'.repeat(32)
const cases = [
  { chain: 'AssetHubPolkadot', symbol: 'DOT', id: '50000546', foreignBalance: 900n },
  { chain: 'AssetHubKusama', symbol: 'KSM', id: '1234', foreignBalance: 20_000n }
] as const

const createApi = (foreignBalance = 900n) => {
  const queryState = vi.fn(({ module }: { module: string }) =>
    Promise.resolve(
      module === 'System'
        ? { data: { free: 20_000_000_000n, reserved: 0n, frozen: 0n } }
        : { balance: foreignBalance }
    )
  )
  const api = {
    _customCtx: {},
    init: vi.fn(),
    isChainEvm: () => false,
    validateSubstrateAddress: () => true,
    queryState,
    findAssetInfoOrThrow,
    findNativeAssetInfoOrThrow,
    getNativeAssetSymbol,
    getExistentialDeposit: () => 100n,
    config: { abstractDecimals: false }
  } as unknown as PolkadotApi<unknown, unknown, unknown>
  return { api, queryState }
}

describe.each(cases)('$chain native asset identity', ({ chain, symbol, id, foreignBalance }) => {
  const foreign = findAssetInfoOrThrow(chain, { id })
  const native = findNativeAssetInfoOrThrow(chain)

  it('reads a same-symbol foreign asset from Assets.Account', async () => {
    const { api, queryState } = createApi(foreignBalance)
    expect(foreign.symbol).toBe(symbol)
    expect(foreign.isNative).not.toBe(true)
    expect(await getAssetBalanceInternal({ api, chain, address, asset: foreign })).toBe(
      foreignBalance
    )
    expect(queryState).toHaveBeenCalledExactlyOnceWith({
      module: 'Assets',
      method: 'Account',
      params: [Number(id), address]
    })
  })

  it('keeps the genuine native asset on System.Account', async () => {
    const { api, queryState } = createApi(foreignBalance)
    expect(await getAssetBalanceInternal({ api, chain, address, asset: native })).toBe(
      20_000_000_000n - BigInt(native.existentialDeposit)
    )
    expect(queryState).toHaveBeenCalledExactlyOnceWith({
      module: 'System',
      method: 'Account',
      params: [address]
    })
  })

  it('uses the selected foreign balance for transferable amount', async () => {
    const { api } = createApi(foreignBalance)
    const result = await getTransferableAmountInternal({
      api,
      origin: chain,
      destination: chain,
      sender: address,
      currency: { id, amount: 1n },
      version: Version.V5,
      buildTx: vi.fn()
    })
    expect(result).toBe(foreignBalance - BigInt(foreign.existentialDeposit))
  })

  it('does not report a foreign asset sufficient just because native funds exist', async () => {
    const { api } = createApi(0n)
    expect(
      await isSufficientOrigin(
        api,
        chain,
        chain,
        address,
        1n,
        { ...foreign, amount: 100n },
        undefined
      )
    ).toBe(false)
  })

  it('does not apply native destination sufficiency to a same-symbol foreign asset', async () => {
    const { api, queryState } = createApi(foreignBalance)
    expect(
      await isSufficientDestination(api, chain, address, { ...foreign, amount: 100n }, 1n)
    ).toBeUndefined()
    expect(queryState).not.toHaveBeenCalled()
  })

  it('recognizes native destination identity even when origin metadata marks it foreign', async () => {
    const { api } = createApi(foreignBalance)
    expect(
      await isSufficientDestination(
        api,
        chain,
        address,
        { ...native, isNative: false, amount: 100n },
        1n
      )
    ).toBe(true)
  })

  it('keeps native and foreign mint operations on their respective pallets', async () => {
    const { api } = createApi(foreignBalance)
    const instance = getSubstrateChainImpl(chain)
    const nativeMint = await instance.mint(api, address, { ...native, amount: 10n }, 0n)
    const foreignMint = await instance.mint(api, address, { ...foreign, amount: 10n }, 0n)
    expect(nativeMint.balanceTx.module).toBe('Balances')
    expect(foreignMint.balanceTx.module).toBe('Assets')
    expect(foreignMint.balanceTx.params).toMatchObject({ id: Number(id) })
  })
})

it('preserves the Mythos mint exception for bridged MYTH metadata', async () => {
  const { api } = createApi()
  const asset = {
    ...findNativeAssetInfoOrThrow('Mythos'),
    isNative: false,
    location: { parents: 2, interior: 'Here' } as const,
    amount: 10n
  }
  const result = await getSubstrateChainImpl('Mythos').mint(api, address, asset, 0n)
  expect(result.balanceTx.module).toBe('Balances')
})
