import { assert } from 'console'
import { combineLatest, forkJoin, Observable, of, pipe, throwError } from 'rxjs'
import { catchError, delay, mergeMap, tap, toArray } from 'rxjs/operators'
import { Mux, MuxConfig } from '../index'

type AnyKeyValuePair = {
    k: number
    v: string
}

type MockWorkerType = {
    pretendToDoSomeStuff: (req: AnyKeyValuePair) => Observable<AnyKeyValuePair>
}
const createMockWorker = (): MockWorkerType => ({
    pretendToDoSomeStuff: (req: AnyKeyValuePair): Observable<AnyKeyValuePair> =>
        of(req),
})

describe('Observable/Subject Multiplexer', () => {
    const muxConfig: MuxConfig = {
        bufferTime: 500,
        retryCoolDown: 100,
        maxRetries: 1,
    }
    describe('Basic functionality', () => {
        let sut: Mux<string, string>
        beforeEach(() => {
            sut = new Mux<string, string>(
                muxConfig,
                (req: string) => req, // get discriminator
                (
                    req: string, // worker function
                ) => of(req).pipe(delay(500)),
            )
        })

        it('should create an instance', () => {
            expect(sut).toBeTruthy()
        })

        it('should execute the provided worker', (done) => {
            sut.next$(of('2')).subscribe((x) => {
                expect(x).toBe('2')
                done()
            })
        })

        it('should complete when a result is returned', (done) => {
            forkJoin([sut.next$(of('0'))]).subscribe(([result]) => {
                expect(result).toBe('0')
                expect(sut.inProgress()).toBeFalsy()
                done()
            })
        })

        it('should handle multiple subjects/keys of a given type', (done) => {
            forkJoin([sut.next$(of('0')), sut.next$(of('1'))]).subscribe(
                ([a1, a2]) => {
                    expect(a1).toBe('0')
                    expect(a2).toBe('1')
                    done()
                },
            )
        })
    })

    describe('buffering multiple updates', () => {
        let sut: Mux<AnyKeyValuePair, AnyKeyValuePair>

        beforeEach(() => {
            sut = new Mux<AnyKeyValuePair, AnyKeyValuePair>(
                muxConfig,
                (req) => req.k.toString(), // get discriminator
                (req) => of(req).pipe(delay(500)), // worker function
            )
        })

        it('should handle multiple updates to a key and return the last value from the buffered set', (done) => {
            forkJoin([
                sut.next$(of({ k: 1, v: '0' })),
                sut.next$(of({ k: 1, v: '1' })),
                sut.next$(of({ k: 1, v: '2' })),
            ]).subscribe(([update1Result, update2Result, update3Result]) => {
                expect(update1Result.v).toBe('2')
                expect(update2Result.v).toBe('2')
                expect(update3Result.v).toBe('2')
                done()
            })
        })

        it('forkJoin should resolve the same value for a given subject key', (done) => {
            forkJoin([
                sut.next$(of({ k: 1, v: '0' })),
                sut.next$(of({ k: 2, v: '1' })),
                sut.next$(of({ k: 1, v: '2' })),
                sut.next$(of({ k: 2, v: '3' })),
            ]).subscribe(([subjectA_1, subjectB_1, subjectA_2, subject_B2]) => {
                expect(subjectA_1.v).toBe('2')
                expect(subjectA_2.v).toBe('2')
                expect(subjectB_1.v).toBe('3')
                expect(subject_B2.v).toBe('3')
                done()
            })
        })

        it('combineLatest should resolve the same value for a given subject key', (done) => {
            combineLatest([
                sut.next$(of({ k: 1, v: '0' })),
                sut.next$(of({ k: 2, v: '1' })),
                sut.next$(of({ k: 1, v: '2' })),
                sut.next$(of({ k: 2, v: '3' })),
            ])
                .pipe(
                    mergeMap((x) => x),
                    toArray(),
                )
                .subscribe(
                    ([subjectA_1, subjectB_1, subjectA_2, subjectB_2]) => {
                        expect(subjectA_1.v).toBe('2')
                        expect(subjectA_2.v).toBe('2')
                        expect(subjectB_1.v).toBe('3')
                        expect(subjectB_2.v).toBe('3')
                        done()
                    },
                )
        })
    })

    describe('retry on error', () => {
        type MockWorkerType = {
            pretendToDoSomeStuff: (
                req: AnyKeyValuePair,
            ) => Observable<AnyKeyValuePair>
        }
        let sut: Mux<AnyKeyValuePair, AnyKeyValuePair>
        let workerMock: MockWorkerType
        const inputValue = { k: 1, v: '0' }
        const testErrorMessage = 'test-error'

        function createMockWorker(): MockWorkerType {
            return {
                pretendToDoSomeStuff: (
                    req: AnyKeyValuePair,
                ): Observable<AnyKeyValuePair> => {
                    return of(req)
                },
            }
        }

        beforeEach(() => {
            workerMock = createMockWorker()
            sut = new Mux<AnyKeyValuePair, AnyKeyValuePair>(
                muxConfig,
                (req) => req.k.toString(), // get discriminator
                (req) => workerMock.pretendToDoSomeStuff(req), // worker function
            )
        })

        it('should normally return the same value as the input (mock worker implementation)', (done) => {
            jest.spyOn(workerMock, 'pretendToDoSomeStuff')

            forkJoin([sut.next$(of(inputValue))]).subscribe(([outputValue]) => {
                expect(workerMock.pretendToDoSomeStuff).toHaveBeenCalledWith(
                    inputValue,
                )
                expect(outputValue).toEqual(inputValue)
                done()
            })
        })

        it('should retry the number of times defined in "maxRetries" before throwing an error', (done) => {
            const innerSpy = jest.fn()
            jest.spyOn(workerMock, 'pretendToDoSomeStuff').mockImplementation(
                (req) =>
                    of(req).pipe(
                        tap((x) => {
                            innerSpy()
                        }),
                        mergeMap((x) => throwError(testErrorMessage)),
                    ),
            )
            sut.next$(of(inputValue))
                .pipe(catchError((err) => of(err)))
                .subscribe((err) => {
                    tap((x) => console.log('mux result:', x))
                    expect(err).toEqual(testErrorMessage)
                    expect(innerSpy).toHaveBeenCalledTimes(
                        1 + muxConfig.maxRetries,
                    )
                    done()
                })
        })

        it('should allow you to catch an error', (done) => {
            jest.spyOn(workerMock, 'pretendToDoSomeStuff').mockReturnValue(
                throwError(testErrorMessage),
            )

            sut.next$(of(inputValue))
                .pipe(
                    catchError((err) => {
                        expect(err).toEqual(testErrorMessage)
                        done()
                        return of(err)
                    }),
                )
                .subscribe((err) => {})
        })

        it('should be complete after an error', (done) => {
            jest.spyOn(workerMock, 'pretendToDoSomeStuff').mockReturnValue(
                throwError(testErrorMessage),
            )

            sut.next$(of(inputValue)).subscribe(
                () => {},
                (err) => {
                    expect(err).toEqual(testErrorMessage)
                    expect(sut.inProgress()).toBe(false)
                    done()
                },
            )
        })
    })

    describe('feature: cancellation of in progress worker', () => {
        // jest.setTimeout(3000)

        const testCaseMuxConfig: MuxConfig = {
            bufferTime: 500,
            retryCoolDown: 100,
            maxRetries: 1,
        }

        let sut: Mux<AnyKeyValuePair, AnyKeyValuePair>
        let workerMock: MockWorkerType

        beforeEach(() => {
            workerMock = createMockWorker()
            sut = new Mux<AnyKeyValuePair, AnyKeyValuePair>(
                testCaseMuxConfig,
                (req) => req.k.toString(), // get discriminator
                (req) => workerMock.pretendToDoSomeStuff(req),
            )
        })

        it('should cancel a worker thats in progress when the subject emits new data ', (done) => {
            const innerSpy = jest.fn()
            jest.spyOn(workerMock, 'pretendToDoSomeStuff').mockImplementation(
                (req) =>
                    of(req).pipe(
                        tap((x) => {
                            innerSpy()
                        }),
                        delay(+req.v * 100),
                    ),
            )

            const firstUpdate = of({ k: 1, v: '15' })
                .pipe(mergeMap((req) => sut.next$(of(req))))
                .subscribe()
            const secondUpdate = of({ k: 1, v: '0' })
                .pipe(
                    delay(testCaseMuxConfig.bufferTime * 1.2),
                    mergeMap((req) => sut.next$(of(req))),
                )
                .subscribe((a) => {
                    expect(innerSpy).toHaveBeenCalledTimes(2)
                    expect(a.v).toEqual('0')
                    done()
                })
        })
    })
})
