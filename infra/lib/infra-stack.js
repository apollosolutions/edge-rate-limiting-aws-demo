import {
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as cloudfrontOrigins,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_event_sources,
  aws_secretsmanager as secrets,
  CfnOutput,
  RemovalPolicy,
  Stack,
} from "aws-cdk-lib";
import {
  AllowedMethods,
  LambdaEdgeEventType,
} from "aws-cdk-lib/aws-cloudfront";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import * as gateway from "@aws-cdk/aws-apigatewayv2-alpha";
import * as integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { join } from "path";

export class InfraStack extends Stack {
  /**
   * @param {import("constructs").Construct} scope
   * @param {string} id
   * @param {import("aws-cdk-lib").StackProps=} props
   */
  constructor(scope, id, props) {
    super(scope, id, props);

    /* --- secrets -----------------------------------------------------------*/

    const apolloKey = secrets.Secret.fromSecretCompleteArn(
      this,
      "apollo-key",
      this.node.tryGetContext("apolloKeyArn")
    );

    /* --- demo api ----------------------------------------------------------*/

    const apiLambda = new lambda.Function(this, "DemoApiLambda", {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset(join(process.cwd(), "../api/out")),
      handler: "index.handler",
    });

    const apiRoute = new integrations.HttpLambdaIntegration(
      "ApiLambdaIntegration",
      apiLambda,
      {
        payloadFormatVersion: gateway.PayloadFormatVersion.VERSION_2_0,
      }
    );

    const api = new gateway.HttpApi(this, "DemoApiGateway", {
      defaultIntegration: apiRoute,
    });

    /* --- dynamodb for all storage ----------------------------------------- */

    const TABLE_NAME = "EdgeRateLimiting";
    const dynamoDb = new dynamodb.Table(this, "EdgeRateLimiting", {
      tableName: TABLE_NAME,
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ExpireAt",
    });

    /* --- edge lambda function --------------------------------------------- */

    const edgeLambda = new cloudfront.experimental.EdgeFunction(
      this,
      "EdgeRateLimitLambda",
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        code: lambda.Code.fromAsset(join(process.cwd(), "../edge-lambda/out")),
        handler: "index.handler",
      }
    );

    dynamoDb.grantFullAccess(edgeLambda);

    /* --- cloudfront distribution ------------------------------------------ */

    // Point to the demo API gateway as the cloudfront origin.
    const cloudfrontOrigin = new cloudfrontOrigins.HttpOrigin(
      `${api.httpApiId}.execute-api.${this.region}.amazonaws.com`
    );

    const cloudfrontDistribution = new cloudfront.Distribution(
      this,
      "EdgeRateLimitCloudfront",
      {
        defaultBehavior: {
          origin: cloudfrontOrigin,
          allowedMethods: AllowedMethods.ALLOW_ALL, // allow POST
          edgeLambdas: [
            {
              functionVersion: edgeLambda.currentVersion,
              eventType: LambdaEdgeEventType.VIEWER_REQUEST, // fire on every request
              includeBody: true, // provide the POST body with the GraphQL request (there's a 40kb limit though!)
            },
          ],
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy
              .CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      }
    );

    /* --- lambda for cost analysis ----------------------------------------- */

    const costAnalysisLambda = new lambda.Function(this, "CostAnalysisLambda", {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset(join(process.cwd(), "../cost-analysis/out")),
      handler: "index.handler",
      environment: {
        TABLE_NAME: dynamoDb.tableName,
        APOLLO_GRAPH_REF: `${process.env.APOLLO_GRAPH_REF}`,
        APOLLO_KEY_ARN: apolloKey.secretArn,
      },
    });

    // Trigger on every write to the database table to rapidly respond to enqueued operations
    costAnalysisLambda.addEventSource(
      new aws_lambda_event_sources.DynamoEventSource(dynamoDb, {
        startingPosition: StartingPosition.TRIM_HORIZON,
        retryAttempts: 2,
      })
    );

    dynamoDb.grantFullAccess(costAnalysisLambda);
    apolloKey.grantRead(costAnalysisLambda); // for access to the schema registry

    /* --- output ----------------------------------------------------------- */
    new CfnOutput(this, "CloudfrontDomainName", {
      value: cloudfrontDistribution.distributionDomainName,
    });
    new CfnOutput(this, "ApiGatewayUrl", { value: api.apiEndpoint });
  }
}
