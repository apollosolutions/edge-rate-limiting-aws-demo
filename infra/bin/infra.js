#!/usr/bin/env node

import cdk from "aws-cdk-lib";
import { InfraStack } from "../lib/infra-stack.js";

const app = new cdk.App();
new InfraStack(app, "EdgeRateLimitingDemo", {
  env: {
    region: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
  },
});
