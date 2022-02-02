import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const ONE_DAY_IN_SECONDS = 60 * 60 * 24;

/**
 * Cache the cost of an operation (by operation hash) for quick lookup in the
 * edge rate limiting lambda.
 *
 * Also stores the schema version used to calculate the cost to support
 * invalidating the cost on schema changes.
 *
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoDb
 * @param {{ hash: string; cost: number; schemaVersion: string; }} params
 */
export async function storeCost(dynamoDb, params) {
  console.log(`* [STORE COST]`, params);

  const command = new UpdateItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: {
      id: { S: `cost:${params.hash}` },
    },
    UpdateExpression:
      "SET Cost = :cost, SchemaVersion = :schemaVersion, ExpireAt = :expireAt",
    ExpressionAttributeValues: {
      ":cost": { N: `${params.cost}` },
      ":schemaVersion": { S: params.schemaVersion },
      ":expireAt": {
        N: `${Math.round(
          Date.now().valueOf() / 1000 + ONE_DAY_IN_SECONDS * 30
        )}`,
      },
    },
  });

  return dynamoDb.send(command);
}
