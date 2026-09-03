import type { SignalStrategy } from '../types'
import { TrysteroTransport } from './trystero'
import type { SignallingTransport } from './types'

export type TransportFactory = (strategy: SignalStrategy) => SignallingTransport

export function createTransport(strategy: SignalStrategy): SignallingTransport {
  return new TrysteroTransport(strategy)
}
