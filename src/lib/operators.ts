import { OperatorFunction } from 'rxjs'
import { map } from 'rxjs/operators'

export const pop = <T>(): OperatorFunction<Array<T>, T | undefined> =>
    map<Array<T>, T | undefined>((x) => x.pop())
export const isTruthy = <T>(val: T | null | undefined): boolean => !!val
