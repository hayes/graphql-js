import type { ObjMap, ReadOnlyObjMap } from './ObjMap.js';
/**
 * Creates an object map with the same keys as `map` and values generated by
 * running each value of `map` thru `fn`.
 */
export declare function mapValue<T, V>(map: ReadOnlyObjMap<T>, fn: (value: T, key: string) => V): ObjMap<V>;
