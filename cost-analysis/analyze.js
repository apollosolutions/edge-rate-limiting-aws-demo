import {
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  Kind,
  isIntrospectionType,
  getNamedType,
  isScalarType,
} from "graphql";

/**
 * Compute the cost of an operation by counting fields. Can use the @cost(weight)
 * directive to override the default cost.
 *
 * @param {string} op
 * @param {import("graphql").GraphQLSchema} schema
 * @param {{ defaultFieldCost: number; defaultScalarCost: number; }} operations
 * @returns {number}
 */
export function computeCost(
  op,
  schema,
  { defaultFieldCost, defaultScalarCost }
) {
  const doc = parse(op);
  const typeInfo = new TypeInfo(schema);

  let cost = 0;

  visit(
    doc,
    visitWithTypeInfo(typeInfo, {
      Field() {
        const field = typeInfo.getFieldDef();
        if (field?.type && isIntrospectionType(getNamedType(field.type))) {
          return;
        }

        const costDirective = field?.astNode?.directives?.find(
          (d) => d.name.value === "cost"
        );

        const complexity = costDirective?.arguments?.find(
          (a) => a.name.value === "weight"
        )?.value;

        const isScalar = isScalarType(field?.type);

        cost +=
          (complexity?.kind === Kind.INT || complexity?.kind === Kind.STRING) &&
          complexity?.value
            ? parseInt(complexity?.value, 10)
            : isScalar
            ? defaultScalarCost
            : defaultFieldCost;
      },
    })
  );

  return cost;
}
