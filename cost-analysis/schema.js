import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { parse, buildASTSchema } from "graphql";
import { request } from "graphql-request";

const secretsClient = new SecretsManagerClient({});

const op = `#graphql
  query ApiSchema($graph: ID!, $variant: String!) {
    service(id: $graph) {
      id
      variant(name: $variant) {
        activeSchemaPublish {
          schema {
            version: hash
            sdl: document
          }
        }
      }
    }
  }
`;

/**
 * Fetch the latest schema and version from Apollo Studio.
 *
 * @returns {Promise<{ version: string; schema: import("graphql").GraphQLSchema; }>}
 */
export async function getSchemaFromRegistry() {
  const apiKey = await getApolloKey();

  if (!apiKey) {
    throw new Error("missing apollo api key");
  }

  if (!process.env.APOLLO_GRAPH_REF) {
    throw new Error("missing graph ref");
  }

  const [graph, variant] = process.env.APOLLO_GRAPH_REF.split("@");

  const data = await request(
    "https://graphql.api.apollographql.com/api/graphql",
    op,
    {
      graph,
      variant,
    },
    {
      "x-api-key": apiKey,
      "apollographql-client-name": "edge-rate-limiting-demo",
    }
  );

  if (!data?.service?.variant?.activeSchemaPublish?.schema) {
    console.log(data);
    throw new Error("invalid response");
  }

  const { version, sdl } = data.service.variant.activeSchemaPublish.schema;

  return {
    version,
    schema: buildASTSchema(parse(sdl)),
  };
}

/**
 * Store the most recent schema version in DynamoDB to invalidate old cached
 * cost mappings.
 *
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoDb
 * @param {string} version
 */
export async function storeSchemaVersion(dynamoDb, version) {
  const command = new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: { id: { S: "SchemaVersion" } },
    UpdateExpression: "SET Version = :version",
    ExpressionAttributeValues: {
      ":version": { S: version },
    },
  });

  return dynamoDb.send(command);
}

/**
 * Fetch the Apollo API key from Secrets Manager.
 *
 * @returns {Promise<string | undefined>}
 */
async function getApolloKey() {
  const command = new GetSecretValueCommand({
    SecretId: process.env.APOLLO_KEY_ARN,
  });

  const resp = await secretsClient.send(command);
  return resp.SecretString;
}
