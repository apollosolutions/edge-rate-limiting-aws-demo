import { buildASTSchema, parse } from "graphql";
import { computeCost } from "../analyze.js";

test("cost analysis", () => {
  const schema = buildASTSchema(
    parse(`#graphql
    directive @cost(
      weight: String!
    ) on ARGUMENT_DEFINITION | ENUM | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | OBJECT | SCALAR

    directive @listSize(
      assumedSize: Int
      requireOneSlicingArgument: Boolean = true
      sizedFields: [String!]
      slicingArguments: [String!]
    ) on FIELD_DEFINITION

    type Query {
      foo: Foo
    }

    type Foo {
      bar: String @cost(weight: "5")
    }
  `)
  );

  const operation = `#graphq
    { foo { bar } }
  `;

  const cost = computeCost(operation, schema, {
    defaultFieldCost: 1,
    defaultScalarCost: 0,
  });

  expect(cost).toEqual(6);
});

test("introspection", () => {
  const schema = buildASTSchema(
    parse(`#graphql
    directive @cost(
      weight: String!
    ) on ARGUMENT_DEFINITION | ENUM | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | OBJECT | SCALAR

    directive @listSize(
      assumedSize: Int
      requireOneSlicingArgument: Boolean = true
      sizedFields: [String!]
      slicingArguments: [String!]
    ) on FIELD_DEFINITION

    type Query {
      foo: Foo
    }

    type Foo {
      bar: String @cost(weight: "5")
    }
  `)
  );

  const operation = `#graphql
    { __schema { queryType { name } } }
  `;

  const cost = computeCost(operation, schema, {
    defaultFieldCost: 1,
    defaultScalarCost: 0,
  });

  expect(cost).toEqual(0);
});
