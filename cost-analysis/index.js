import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { computeCost } from "./analyze.js";
import { storeCost } from "./storage.js";
import { getSchemaFromRegistry, storeSchemaVersion } from "./schema.js";

const dynamoDb = new DynamoDBClient({});

/**
 * For each operation queued up for analysis, statically calculate the cost
 * and store in a key/value cache for future requests.
 *
 * @type {import("aws-lambda").DynamoDBStreamHandler}
 */
export async function handler(event) {
  const { schema, version } = await getSchemaFromRegistry();

  // Store the most recent version so that the edge lambda knows to re-enqueue
  // operations if the schema has changed.
  await storeSchemaVersion(dynamoDb, version);

  for (const record of event.Records) {
    const params = paramsFromRecord(record);
    if (!params) {
      continue;
    }

    const cost = computeCost(params.operation, schema, {
      defaultFieldCost: 1,
      defaultScalarCost: 0,
    });

    await storeCost(dynamoDb, {
      hash: params.hash,
      cost,
      schemaVersion: version,
    });
  }
}

/**
 * Return operation string and sha256 hash for "id=queue:<sha256 hash>" records
 * @param {import("aws-lambda").DynamoDBRecord} record
 */
function paramsFromRecord(record) {
  if (!record.dynamodb?.NewImage?.id?.S?.startsWith("queue:")) {
    return null;
  }

  const prefixedHash = record.dynamodb.Keys?.id?.S;
  const operation = record.dynamodb.NewImage.Operation?.S;

  if (!prefixedHash || !operation) {
    return null;
  }

  return { hash: prefixedHash.split(":")[1], operation };
}
