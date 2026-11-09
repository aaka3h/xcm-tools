import type { TAssetInfo } from '@paraspell/assets'
import { isAssetEqual } from '@paraspell/assets'
import type { TChain } from '@paraspell/sdk-common'

import type { PolkadotApi } from '../../api'

export const isChainNativeAsset = <TApi, TRes, TSigner, TCustomChain extends string = never>(
  api: PolkadotApi<TApi, TRes, TSigner, TCustomChain>,
  chain: TChain | TCustomChain,
  asset: TAssetInfo
): boolean => isAssetEqual(api.findNativeAssetInfoOrThrow(chain), asset)
