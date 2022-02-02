import { BatchGetItemCommand } from "@aws-sdk/client-dynamodb";
import { enqueueForAnalysis } from "./analysis.js";
import { SCHEMA_VERSION_KEY, TABLE_NAME } from "./dynamo.js";

const HIGH_COST = 500;

/**
 * Fetch the cost from storage and return either:
 * - the cost and a no-op promise.
 * - the cost and a promise to re-enqueue the operation for analysis if the
 *   schema has changed since the operation was analyzed
 * - a default high cost if the operation hasn't been analyzed, and a promise
 *   to enqueue the operation for analysis.
 *
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoDb
 * @param {string} hash
 * @param {string} [query]
 * @returns {Promise<[number, Promise<any>, [number, number]]>}
 */
export async function getCost(dynamoDb, hash, query) {
  const start = process.hrtime();

  const { found, cost, schemaVersion, lastSchemaVersion } =
    await getCostAndSchemaVersionRecords(dynamoDb, hash);

  if (found && schemaVersion !== lastSchemaVersion) {
    console.log("COST FOUND, SCHEMA VERSION OLD");
    return [
      cost,
      enqueueForAnalysis(dynamoDb, hash, query),
      process.hrtime(start),
    ];
  } else if (found) {
    console.log("COST FOUND");
    return [cost, Promise.resolve(), process.hrtime(start)];
  } else {
    console.log("USING DEFAULT COST");
    return [
      HIGH_COST,
      enqueueForAnalysis(dynamoDb, hash, query),
      process.hrtime(start),
    ];
  }
}

/**
 * Fetch both the cached cost of an operation, and the most recent version of the
 * schema.
 *
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoDb
 * @param {string} hash
 */
async function getCostAndSchemaVersionRecords(dynamoDb, hash) {
  const costKey = {
    id: { S: `cost:${hash}` },
  };

  const command = new BatchGetItemCommand({
    RequestItems: {
      [TABLE_NAME]: {
        Keys: [
          SCHEMA_VERSION_KEY, // for last schema version used for cost analysis
          costKey, // for cost of this operation
        ],
      },
    },
  });

  const result = await dynamoDb.send(command);

  if (!result.Responses?.[TABLE_NAME]) {
    console.log(result.Responses);
    throw new Error("invalid response from dynamodb");
  }

  const cost = result.Responses[TABLE_NAME].find((value) =>
    value.id?.S?.startsWith("cost:")
  );
  const schemaVersion = result.Responses[TABLE_NAME].find(
    (value) => value.id?.S === "SchemaVersion"
  );

  return {
    found: !!cost,
    cost: cost?.Cost?.N ? parseInt(cost.Cost.N) : HIGH_COST,
    schemaVersion: cost?.SchemaVersion?.S,
    lastSchemaVersion: schemaVersion?.Version?.S,
  };
}
