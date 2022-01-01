import {
    BehaviorSubject,
    forkJoin,
    MonoTypeOperatorFunction,
    Observable,
    of,
    Subject,
    throwError,
} from 'rxjs'
import {
    bufferTime,
    catchError,
    concatMap,
    delay,
    filter,
    first,
    map,
    mergeMap,
    retryWhen,
    scan,
    skip,
    switchMap,
    tap,
} from 'rxjs/operators'
import { IMuxRegistryEntry } from './IMuxRegistryEntry'
import { MuxConfig } from './MuxConfig'
import { MuxRegistry } from './MuxRegistry'
import { isTruthy, pop } from './operators'

/**
 * Mux is a simple multiplexer that buffers multiple operations and only allows the last one to be emitted.
 * allows discrimination of operations by key.
 * It is useful for situations where you want to ensure that only the last operation is executed.
 */
export class Mux<TRequest, TResponse> {
    registry: MuxRegistry<TRequest, TResponse> = {}

    /**
     *
     * @param config the configuration for the mux instance
     * @param getDiscriminator - a function that derives a key from the request model (e.g. a id)
     * @param worker the inner observable that will be executed (e.g. a http request/query/etc)
     * @param TRequest the request model
     */
    constructor(
        private config: MuxConfig,
        private getKey: (req: TRequest) => string,
        private worker: (req: TRequest) => Observable<TResponse>,
    ) {}

    /**
     * multiplexes an observable by key and returns a single observable that emits the last value of the keyed multiplexed observable
     */
    next$ = (stream: Observable<TRequest>) =>
        stream.pipe(
            switchMap((req) =>
                forkJoin([
                    of(req),
                    of(this.getRegistryEntry(this.getKey(req))),
                ]),
            ),
            tap(([req, { ingress$ }]) => ingress$.next(req)),
            concatMap(([, { result$ }]) => result$.pipe(skip(1), first())),
        )
    /**
     * determines if any active subjects are unresolved
     */
    inProgress = () =>
        Object.keys(this.registry)
            .map(
                (key) =>
                    !this.registry[key].ingress$.isStopped &&
                    !this.registry[key].result$.isStopped &&
                    !this.registry[key].result$.closed &&
                    !this.registry[key].result$.hasError,
            )
            .reduce((isComplete, next) => isComplete || next, false)

    private getRegistryEntry = (
        key: string,
    ): IMuxRegistryEntry<TRequest, TResponse> =>
        this.tryUseActiveStream(this.registry[key]) ??
        this.createStreamWithKey(key)

    private tryUseActiveStream = (
        muxInstance: IMuxRegistryEntry<TRequest, TResponse>,
    ): IMuxRegistryEntry<TRequest, TResponse> | null => {
        return !!muxInstance &&
            !muxInstance.ingress$.closed &&
            !muxInstance.ingress$.isStopped
            ? muxInstance
            : null
    }

    private createStreamWithKey = (
        key: string,
    ): IMuxRegistryEntry<TRequest, TResponse> => {
        const ingress$ = new Subject<TRequest>()
        const result$ = new BehaviorSubject<TResponse>(
            null as unknown as TResponse,
        )

        this.createBufferedWorkerPipe(ingress$)
            .pipe(first())
            .subscribe(
                (x) => {
                    ingress$.complete()
                    result$.next(x)
                    result$.complete()
                },
                (err) => {
                    ingress$.error(err)
                    result$.error(err)
                },
                () => {
                    result$.complete()
                    ingress$.complete()

                    this.removeInstanceByKey(key)
                },
            )

        this.add({ key, ingress$, result$ })

        return this.registry[key]
    }

    private retryWithDelay =
        <T>({
            maxRetries,
            retryCoolDown,
        }: MuxConfig): MonoTypeOperatorFunction<T> =>
        (input) =>
            input.pipe(
                retryWhen((errors) =>
                    errors.pipe(
                        tap((x) =>
                            console.log(
                                'the worker encountered a problem, retrying:',
                                x,
                            ),
                        ),
                        scan(
                            (acc, error) => ({ count: acc.count + 1, error }),
                            {
                                count: 0,
                                error: new Error(
                                    `${maxRetries} retries failed`,
                                ),
                            },
                        ),
                        map((current) => {
                            console.log('retrying:', current)
                            if (current.count > maxRetries) {
                                throw current.error
                            }
                            return current
                        }),
                        delay(retryCoolDown),
                    ),
                ),
            )

    private add = (entry: IMuxRegistryEntry<TRequest, TResponse>) => {
        this.registry[entry.key] = entry
    }

    private removeInstanceByKey = (key: string) => {
        delete this.registry[key]
    }

    private createBufferedWorkerPipe = (
        ingress$: Observable<TRequest>,
    ): Observable<TResponse> =>
        ingress$.pipe(
            bufferTime(this.config.bufferTime),
            filter((x) => x.length > 0),
            pop(),
            filter((x) => isTruthy(x)),
            mergeMap((req) =>
                this.worker(req as TRequest).pipe(
                    this.retryWithDelay(this.config),
                    catchError((err) => throwError(err)),
                ),
            ),
            first(),
        )
}
