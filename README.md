# Cost-based GraphQL Rate Limiting at the Edge (AWS-flavored)

**The code in this repository is experimental and has been provided for reference purposes only. Community feedback is welcome but this project may not be supported in the same way that repositories in the official [Apollo GraphQL GitHub organization](https://github.com/apollographql) are. If you need help you can file an issue on this repository, [contact Apollo](https://www.apollographql.com/contact-sales) to talk to an expert, or create a ticket directly in Apollo Studio.**

## Problem Description

Rate limiting GraphQL APIs at the edge is challenging because:

- Requests of every size and shape all go through the same endpoint.
- Determining the resources used by the request requires parsing the operation document.
- Determining the total cost of the request usually requires access to the full schema.

This project tests the hypothesis that it's possible to overcome these challenges with some specific assumptions.

1. The number of unique operation documents is finite (10s, 100s, or 1000s).
2. A simple SHA 256 hash of the `query` string is enough to quickly identify an operation.
3. We can assume that any previously unidentified documents are expensive and should be rate limited heavily.
   - We will allow any unidentified documents through at least once. We're trying to prevent abuse of resources through repeated requests, and this solution allows new clients with new operation shapes to function normally.
4. We can asynchronously analyze each unidentified document for resource usage and cache the results for future requests.

## Architecture Overview

1. Cloudfront Distribution

   Accepts GraphQL requests from the client. Its origin server is the Demo GraphQL API. Is configured to execute the Lambda@edge function on every client request.

2. Lambda@edge "viewer request" function

   Checks the cost of an operation and rate limits the request based on total aggregate cost for the client IP Address over a sliding window. Leverages an external store for operation cost and per-IP rate limiting data.

3. DynamoDB table for all storage

   Stores:

   - Cost for each operation
   - A queue of operations to analyze for cost
   - Per-IP rate limit data
   - The most recent version of the schema from the Schema Registry

4. Cost analysis lambda

   Listens to a stream of updates on the DynamoDB table for operations to analyze. Fetches the schema with type and field cost metadata from the Schema Registry.

5. Demo GraphQL API (API Gateway + Lambda)

   A simple GraphQL API.

6. Apollo Studio Schema Registry

## Prerequisites

- Node 16
- Yarn
- An Apollo Studio Account, existing graph, and API KEY
- An AWS Account and credentials

## Setup

1. Export environment variables

   ```sh
   export AWS_ACCESS_KEY_ID=<your access key id>
   export AWS_SECRET_ACCESS_KEY=<your secret access key>
   export AWS_DEFAULT_REGION=<region closest to you>
   export APOLLO_KEY=<your apollo key>
   export APOLLO_GRAPH_REF=<yourgraph@current>
   ```

2. Create secrets (delete these when done—they cost money!)

   ```sh
   aws secretsmanager create-secret --region $AWS_DEFAULT_REGION --name apollo-key --secret-string $APOLLO_KEY
   ```

   The result will look something like:

   ```json
   {
     "ARN": "arn:aws:secretsmanager:us-east-1:123456789000:secret:apollo-key-123456",
     "Name": "apollo-key",
     "VersionId": "12345678-888d-40ac-a348-89499a47cb64"
   }
   ```

   Add the ARN to the cdk.json:

   ```json
   {
     // ...
     "context": {
       // ...
       "apolloKeyArn": "arn:aws:secretsmanager:us-east-1:123456789000:secret:apollo-key-123456"
     }
   }
   ```

3. Install dependencies, build apps

   ```sh
   yarn install
   yarn build
   ```

4. Bootstrap CDK and deploy

   ```sh
   yarn workspace infra cdk bootstrap

   # if you set your region to something other than us-east-1, you'll also need
   # to bootstrap us-east-1 for the lambda@edge worker
   AWS_DEFAULT_REGION=us-east-1 yarn workspace infra cdk bootstrap
   ```

5. Setup Apollo Graph

   ```sh
   rover graph publish mygraph@current --schema api/schema.graphql
   ```

6. Deploy

   ```sh
   yarn workspace infra cdk deploy --all
   ```

   This may take 20 minutes because of the Cloudfront distribution. After it completes, you should see output similar to:

   ```
   ✅  EdgeRateLimitingDemo

   ✨  Deployment time: 363.84s

   Outputs:
   EdgeRateLimitingDemo.ApiGatewayUrl = https://abcd12340x00.execute-api.us-east-1.amazonaws.com
   EdgeRateLimitingDemo.CloudfrontDomainName = deadbeef0x00.cloudfront.net
   ```

7. Test

   ```sh
   curl https://deadbeef0x00.cloudfront.net -H 'content-type: application/json' -d '{"query":"{astronauts{name}}"}'
   ```

## Smoke Tests (TODO)

- [ ] Execute a new inexpensive operation multiple times. The first request is rate limited heavily, but subsequent requests use the correct (low) score.
- [ ] Execute many new inexpensive operations. All requests are rate limited heavily.
- [ ] Execute a new expensive operation. All requests are rate limited heavily.
- [ ] The APQ request/response flow.
- [ ] Updating cost metadata in the schema, converting an inexpensive operation to an expensive operation.

## Caveats

- Federated graphs don't work yet. There isn't a way to compose the `@cost` directive from subgraphs into the supergraph.
- DynamoDB is just for demonstration purposes. In production a lower-latency data store like Redis would be more realistic and have a smaller performance impact.
- The rate limiting lambda functions run in the region closest to the user, but the DynamoDB table exists in only one region. This has a non-trivial affect on latency.
- Lambda@edge has several limitations, including a 40KB limit for POST request bodies.
- The cost analysis and rate limiting algorithms are naive and not production-ready.
