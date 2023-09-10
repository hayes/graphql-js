import { AccumulatorMap } from '../jsutils/AccumulatorMap.mjs';
import { getBySet } from '../jsutils/getBySet.mjs';
import { invariant } from '../jsutils/invariant.mjs';
import { isSameSet } from '../jsutils/isSameSet.mjs';
import { OperationTypeNode } from '../language/ast.mjs';
import { Kind } from '../language/kinds.mjs';
import { isAbstractType } from '../type/definition.mjs';
import {
  GraphQLDeferDirective,
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
} from '../type/directives.mjs';
import { typeFromAST } from '../utilities/typeFromAST.mjs';
import { getDirectiveValues } from './values.mjs';
export const NON_DEFERRED_TARGET_SET = new Set([undefined]);
/**
 * Given a selectionSet, collects all of the fields and returns them.
 *
 * CollectFields requires the "runtime type" of an object. For a field that
 * returns an Interface or Union type, the "runtime type" will be the actual
 * object type returned by that field.
 *
 * @internal
 */
export function collectFields(
  schema,
  fragments,
  variableValues,
  runtimeType,
  operation,
) {
  const context = {
    schema,
    fragments,
    variableValues,
    runtimeType,
    operation,
    fieldsByTarget: new Map(),
    targetsByKey: new Map(),
    newDeferUsages: [],
    visitedFragmentNames: new Set(),
  };
  collectFieldsImpl(context, operation.selectionSet);
  return {
    ...buildGroupedFieldSets(context.targetsByKey, context.fieldsByTarget),
    newDeferUsages: context.newDeferUsages,
  };
}
/**
 * Given an array of field nodes, collects all of the subfields of the passed
 * in fields, and returns them at the end.
 *
 * CollectSubFields requires the "return type" of an object. For a field that
 * returns an Interface or Union type, the "return type" will be the actual
 * object type returned by that field.
 *
 * @internal
 */
// eslint-disable-next-line max-params
export function collectSubfields(
  schema,
  fragments,
  variableValues,
  operation,
  returnType,
  fieldGroup,
) {
  const context = {
    schema,
    fragments,
    variableValues,
    runtimeType: returnType,
    operation,
    fieldsByTarget: new Map(),
    targetsByKey: new Map(),
    newDeferUsages: [],
    visitedFragmentNames: new Set(),
  };
  for (const fieldDetails of fieldGroup.fields) {
    const node = fieldDetails.node;
    if (node.selectionSet) {
      collectFieldsImpl(context, node.selectionSet, fieldDetails.target);
    }
  }
  return {
    ...buildGroupedFieldSets(
      context.targetsByKey,
      context.fieldsByTarget,
      fieldGroup.targets,
    ),
    newDeferUsages: context.newDeferUsages,
  };
}
function collectFieldsImpl(context, selectionSet, parentTarget, newTarget) {
  const {
    schema,
    fragments,
    variableValues,
    runtimeType,
    operation,
    targetsByKey,
    fieldsByTarget,
    newDeferUsages,
    visitedFragmentNames,
  } = context;
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        if (!shouldIncludeNode(variableValues, selection)) {
          continue;
        }
        const key = getFieldEntryKey(selection);
        const target = newTarget ?? parentTarget;
        let keyTargets = targetsByKey.get(key);
        if (keyTargets === undefined) {
          keyTargets = new Set();
          targetsByKey.set(key, keyTargets);
        }
        keyTargets.add(target);
        let targetFields = fieldsByTarget.get(target);
        if (targetFields === undefined) {
          targetFields = new AccumulatorMap();
          fieldsByTarget.set(target, targetFields);
        }
        targetFields.add(key, selection);
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        if (
          !shouldIncludeNode(variableValues, selection) ||
          !doesFragmentConditionMatch(schema, selection, runtimeType)
        ) {
          continue;
        }
        const defer = getDeferValues(operation, variableValues, selection);
        let target;
        if (!defer) {
          target = newTarget;
        } else {
          const ancestors =
            parentTarget === undefined
              ? [parentTarget]
              : [parentTarget, ...parentTarget.ancestors];
          target = { ...defer, ancestors };
          newDeferUsages.push(target);
        }
        collectFieldsImpl(
          context,
          selection.selectionSet,
          parentTarget,
          target,
        );
        break;
      }
      case Kind.FRAGMENT_SPREAD: {
        const fragName = selection.name.value;
        if (!shouldIncludeNode(variableValues, selection)) {
          continue;
        }
        const defer = getDeferValues(operation, variableValues, selection);
        if (visitedFragmentNames.has(fragName) && !defer) {
          continue;
        }
        const fragment = fragments[fragName];
        if (
          fragment == null ||
          !doesFragmentConditionMatch(schema, fragment, runtimeType)
        ) {
          continue;
        }
        let target;
        if (!defer) {
          visitedFragmentNames.add(fragName);
          target = newTarget;
        } else {
          const ancestors =
            parentTarget === undefined
              ? [parentTarget]
              : [parentTarget, ...parentTarget.ancestors];
          target = { ...defer, ancestors };
          newDeferUsages.push(target);
        }
        collectFieldsImpl(context, fragment.selectionSet, parentTarget, target);
        break;
      }
    }
  }
}
/**
 * Returns an object containing the `@defer` arguments if a field should be
 * deferred based on the experimental flag, defer directive present and
 * not disabled by the "if" argument.
 */
function getDeferValues(operation, variableValues, node) {
  const defer = getDirectiveValues(GraphQLDeferDirective, node, variableValues);
  if (!defer) {
    return;
  }
  if (defer.if === false) {
    return;
  }
  operation.operation !== OperationTypeNode.SUBSCRIPTION ||
    invariant(
      false,
      '`@defer` directive not supported on subscription operations. Disable `@defer` by setting the `if` argument to `false`.',
    );
  return {
    label: typeof defer.label === 'string' ? defer.label : undefined,
  };
}
/**
 * Determines if a field should be included based on the `@include` and `@skip`
 * directives, where `@skip` has higher precedence than `@include`.
 */
function shouldIncludeNode(variableValues, node) {
  const skip = getDirectiveValues(GraphQLSkipDirective, node, variableValues);
  if (skip?.if === true) {
    return false;
  }
  const include = getDirectiveValues(
    GraphQLIncludeDirective,
    node,
    variableValues,
  );
  if (include?.if === false) {
    return false;
  }
  return true;
}
/**
 * Determines if a fragment is applicable to the given type.
 */
function doesFragmentConditionMatch(schema, fragment, type) {
  const typeConditionNode = fragment.typeCondition;
  if (!typeConditionNode) {
    return true;
  }
  const conditionalType = typeFromAST(schema, typeConditionNode);
  if (conditionalType === type) {
    return true;
  }
  if (isAbstractType(conditionalType)) {
    return schema.isSubType(conditionalType, type);
  }
  return false;
}
/**
 * Implements the logic to compute the key of a given field's entry
 */
function getFieldEntryKey(node) {
  return node.alias ? node.alias.value : node.name.value;
}
function buildGroupedFieldSets(
  targetsByKey,
  fieldsByTarget,
  parentTargets = NON_DEFERRED_TARGET_SET,
) {
  const { parentTargetKeys, targetSetDetailsMap } = getTargetSetDetails(
    targetsByKey,
    parentTargets,
  );
  const groupedFieldSet =
    parentTargetKeys.size > 0
      ? getOrderedGroupedFieldSet(
          parentTargetKeys,
          parentTargets,
          targetsByKey,
          fieldsByTarget,
        )
      : new Map();
  const newGroupedFieldSetDetails = new Map();
  for (const [maskingTargets, targetSetDetails] of targetSetDetailsMap) {
    const { keys, shouldInitiateDefer } = targetSetDetails;
    const newGroupedFieldSet = getOrderedGroupedFieldSet(
      keys,
      maskingTargets,
      targetsByKey,
      fieldsByTarget,
    );
    // All TargetSets that causes new grouped field sets consist only of DeferUsages
    // and have shouldInitiateDefer defined
    newGroupedFieldSetDetails.set(maskingTargets, {
      groupedFieldSet: newGroupedFieldSet,
      shouldInitiateDefer,
    });
  }
  return {
    groupedFieldSet,
    newGroupedFieldSetDetails,
  };
}
function getTargetSetDetails(targetsByKey, parentTargets) {
  const parentTargetKeys = new Set();
  const targetSetDetailsMap = new Map();
  for (const [responseKey, targets] of targetsByKey) {
    const maskingTargetList = [];
    for (const target of targets) {
      if (
        target === undefined ||
        target.ancestors.every((ancestor) => !targets.has(ancestor))
      ) {
        maskingTargetList.push(target);
      }
    }
    const maskingTargets = new Set(maskingTargetList);
    if (isSameSet(maskingTargets, parentTargets)) {
      parentTargetKeys.add(responseKey);
      continue;
    }
    let targetSetDetails = getBySet(targetSetDetailsMap, maskingTargets);
    if (targetSetDetails === undefined) {
      targetSetDetails = {
        keys: new Set(),
        shouldInitiateDefer: maskingTargetList.some(
          (deferUsage) => !parentTargets.has(deferUsage),
        ),
      };
      targetSetDetailsMap.set(maskingTargets, targetSetDetails);
    }
    targetSetDetails.keys.add(responseKey);
  }
  return {
    parentTargetKeys,
    targetSetDetailsMap,
  };
}
function getOrderedGroupedFieldSet(
  keys,
  maskingTargets,
  targetsByKey,
  fieldsByTarget,
) {
  const groupedFieldSet = new Map();
  const firstTarget = maskingTargets.values().next().value;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const firstFields = fieldsByTarget.get(firstTarget);
  for (const [key] of firstFields) {
    if (keys.has(key)) {
      let fieldGroup = groupedFieldSet.get(key);
      if (fieldGroup === undefined) {
        fieldGroup = { fields: [], targets: maskingTargets };
        groupedFieldSet.set(key, fieldGroup);
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      for (const target of targetsByKey.get(key)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const fieldsForTarget = fieldsByTarget.get(target);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const nodes = fieldsForTarget.get(key);
        // the following line is an optional minor optimization
        fieldsForTarget.delete(key);
        fieldGroup.fields.push(...nodes.map((node) => ({ node, target })));
      }
    }
  }
  return groupedFieldSet;
}
