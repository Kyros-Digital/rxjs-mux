import { Subject } from 'rxjs'

export type IMuxRegistryEntry<TRequest, TResponse> = {
    key: string
    ingress$: Subject<TRequest>
    result$: Subject<TResponse>
}
