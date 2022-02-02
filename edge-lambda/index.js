import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { getCost } from "./cost.js";
import { TABLE_NAME } from "./dynamo.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { getQueryFromRequest, handleCors } from "./request.js";

const MAX_COST = 1000;

const dynamoDb = new DynamoDBClient({
  region: "us-west-1",
});

const limiter = new SlidingWindowRateLimiter(dynamoDb, TABLE_NAME, {
  window: 1000 * 60,
  interval: 1000 * 30,
  limit: MAX_COST,
});

/**
 * @type {import("aws-lambda").CloudFrontRequestHandler}
 */
export async function handler(event, _context, callback) {
  const start = process.hrtime();

  const request = event.Records[0].cf.request;
  console.log(request);

  // CORS options request: return very permissive response immediately
  const corsResponse = handleCors(request);
  if (corsResponse) {
    callback(null, corsResponse);
    return;
  }

  // Parse JSON requests (POST, POST with APQ hash, GET with only APQ hash)
  const params = getQueryFromRequest(request);

  // Not a GraphQL request: pass through request to origin as-is
  if (!params.isValidGraphQlRequest) {
    callback(null, request);
    return;
  }

  // Fetch the cost from storage, and possibly enqueue operation for query analysis
  const [cost, enqueuePromise, dbOverhead] = await getCost(
    dynamoDb,
    params.hash,
    params.query
  );

  // Rate limit the request, returning a promise to commit this request to the
  // rate limit storage
  const [{ ok, cost: totalCost }, updatePromise] = await limiter.limit(
    request.clientIp,
    cost
  );

  // If rate limited, return a GraphQL "429" error
  if (!ok) {
    callback(
      null,
      errorResponse({
        message: "rate limit exceeded",
        extensions: { code: 429, cost, totalCost },
      })
    );
  } else {
    const overhead = process.hrtime(start);
    console.log(
      `COMPLETE: cost=${cost}, totalOverhead=${overhead[0]}s ${
        overhead[1] / 1000000
      }ms, dbOverhead=${dbOverhead[0]}s ${dbOverhead[1] / 1000000}ms`
    );
    callback(null, request);
  }

  // Ensure that updates to the analysis queue and rate limit storage complete
  await Promise.all([enqueuePromise, updatePromise]);
}

/**
 * @param {{ message: string; extensions?: { [key: string]: any } }} error
 * @returns {import("aws-lambda").CloudFrontResponseResult}
 */
function errorResponse(error) {
  return {
    status: "200",
    statusDescription: "OK",
    headers: {
      "content-type": [
        {
          key: "Content-Type",
          value: "application/json",
        },
      ],
    },
    body: JSON.stringify({
      errors: [error],
    }),
  };
}
