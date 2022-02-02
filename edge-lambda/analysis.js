import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { TABLE_NAME } from "./dynamo.js";

const FIVE_MINUTES_IN_SECONDS = 60 * 5;
const expireAt = () =>
  Math.round(Date.now().valueOf() / 1000 + FIVE_MINUTES_IN_SECONDS);

/**
 * Store the operation in a queue for asynchronous cost analysis.
 *
 * Queued records expire in five minutes to avoid filling up the table.
 *
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoDb
 * @param {string} hash
 * @param {string} [query]
 */
export async function enqueueForAnalysis(dynamoDb, hash, query) {
  if (!query) {
    console.log(`APQ request for ${hash}, nothing to enqueue for analysis`);
    return;
  }

  const start = process.hrtime();
  const command = new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      id: { S: `queue:${hash}` },
      Operation: { S: query },
      ExpireAt: {
        N: `${expireAt()}`,
      },
    },
  });

  console.log(`* [ENQUEUE]`, command.input);

  await dynamoDb.send(command);
  const end = process.hrtime(start);
  console.info("** %ds %dms [ENQUEUE]", end[0], end[1] / 1000000);
}
