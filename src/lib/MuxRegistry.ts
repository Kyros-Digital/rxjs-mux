import { IMuxRegistryEntry } from './IMuxRegistryEntry'

export type MuxRegistry<TRequest, TResponse> = {
    [key: string]: IMuxRegistryEntry<TRequest, TResponse>
}
