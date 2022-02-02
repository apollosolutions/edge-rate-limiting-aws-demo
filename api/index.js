import { ApolloServer } from "apollo-server-lambda";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { addMocksToSchema } from "@graphql-tools/mock";
import typeDefs from "./schema.graphql";

import * as pkg from "@faker-js/faker";
const { faker } = pkg;

const schema = makeExecutableSchema({
  typeDefs,
});

const mockedSchema = addMocksToSchema({
  schema,
  mocks: {
    Astronaut: {
      name: faker.name.firstName,
    },
  },
});

const server = new ApolloServer({
  schema: mockedSchema,
});

export const handler = server.createHandler();
