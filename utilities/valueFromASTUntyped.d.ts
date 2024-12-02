import type { Maybe } from '../jsutils/Maybe.js';
import type { ObjMap } from '../jsutils/ObjMap.js';
import type { ValueNode } from '../language/ast.js';
/**
 * Produces a JavaScript value given a GraphQL Value AST.
 *
 * No type is provided. The resulting JavaScript value will reflect the
 * provided GraphQL value AST.
 *
 * | GraphQL Value        | JavaScript Value |
 * | -------------------- | ---------------- |
 * | Input Object         | Object           |
 * | List                 | Array            |
 * | Boolean              | Boolean          |
 * | String / Enum        | String           |
 * | Int / Float          | Number           |
 * | Null                 | null             |
 *
 */
export declare function valueFromASTUntyped(valueNode: ValueNode, variables?: Maybe<ObjMap<unknown>>): unknown;
