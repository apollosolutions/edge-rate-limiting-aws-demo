import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";

/**
 * A rate limiter based on timestamped "buckets" of points stored in DynamoDB.
 *
 * If the points accumulated in a certain time window exceeds a threshold, the
 * request is denied.
 *
 * Points are stored in smaller rolling buckets to avoid storing points for
 * every single request.
 *
 * THIS IS NOT PRODUCTION-READY CODE.
 */
export class SlidingWindowRateLimiter {
  /**
   * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} dynamoDb
   * @param {string} tableName
   * @param {{ window: number; interval: number; limit: number; }} options
   */
  constructor(dynamoDb, tableName, options) {
    this.client = dynamoDb;
    this.tableName = tableName;
    this.options = options;
  }

  /**
   * @param {string} ip
   * @returns {Promise<{ ts: number; cost: number; }[]>}
   */
  async get(ip) {
    const start = process.hrtime();

    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: { id: { S: `rate:ip:${ip}` } },
    });

    const result = await this.client.send(command);

    const data = result.Item?.Buckets?.L
      ? result.Item.Buckets.L.map((d) => {
          if (d.M) {
            return {
              ts: d.M.ts?.N ? parseInt(d.M.ts.N) : 0,
              cost: d.M.cost?.N ? parseInt(d.M.cost.N) : 0,
            };
          }
        }).filter(
          /** @type {(a: any) => a is { ts: number; cost: number }} */ (a) =>
            Boolean(a)
        )
      : [];

    const end = process.hrtime(start);
    console.info("* %ds %dms [RATE GET]", end[0], end[1] / 1000000);

    return data;
  }

  /**
   * @param {string} ip
   * @param {{ cost: number; ts: number; }[]} data
   * @returns {Promise<void>}
   */
  async put(ip, data) {
    const start = process.hrtime();

    const value = data.map((d) => {
      return { M: { cost: { N: `${d.cost}` }, ts: { N: `${d.ts}` } } };
    });

    const command = new UpdateItemCommand({
      TableName: this.tableName,
      Key: { id: { S: `rate:ip:${ip}` } },
      UpdateExpression: "SET Buckets = :buckets",
      ExpressionAttributeValues: {
        ":buckets": {
          L: value,
        },
      },
      ReturnValues: "ALL_NEW",
    });

    return this.client.send(command).then(() => {
      const end = process.hrtime(start);
      console.info("* %ds %dms [RATE PUT]", end[0], end[1] / 1000000);
    });
  }

  /**
   * Returns both the rate limit result and a promise to store this request in
   * the datastore, which allows responding to the request without waiting to
   * commit the new data.
   *
   * @param {string} ip
   * @param {number} cost
   * @returns {Promise<[{ ok: boolean; cost: number; }, Promise<void>]>}
   */
  async limit(ip, cost) {
    const data = await this.get(ip);
    const now = Date.now();

    if (!data || !data.length) {
      const promise = this.put(ip, [
        {
          ts: now,
          cost,
        },
      ]);

      return [{ ok: true, cost }, promise];
    }

    const windowStartTS = now - this.options.window;
    const requestsWithinWindow = data.filter(
      (entry) => entry.ts > windowStartTS
    );

    const totalCost = requestsWithinWindow.reduce(
      (acc, entry) => acc + entry.cost,
      0
    );

    if (totalCost + cost > this.options.limit) {
      return [{ ok: false, cost: totalCost + cost }, Promise.resolve()];
    } else {
      const last = data[data.length - 1];

      // add cost to current log
      if (last.ts > now - this.options.interval) {
        last.cost += cost;
      } else {
        // append a new log
        requestsWithinWindow.push({
          ts: now,
          cost,
        });
      }

      const promise = this.put(ip, requestsWithinWindow);

      return [{ ok: true, cost: totalCost + cost }, promise];
    }
  }
}
