import { URLSearchParams } from "url";
import { hashQueryString } from "./hash.js";

/**
 * If POST: parse the body as JSON and return the query (and the sha256 hash
 * if APQ request)
 *
 * If GET: look for the APQ extensions params and return the sha256 hash
 *
 * Returns { isValidGraphQlRequest: false } if request does not appear to be
 * a GraphQL request
 *
 * @param {import("aws-lambda").CloudFrontRequest} request
 * @returns {{ isValidGraphQlRequest: true; hash: string; query?: string; } | { isValidGraphQlRequest: false }}
 */
export function getQueryFromRequest(request) {
  try {
    if (
      request.method === "POST" &&
      request.body?.data &&
      request.headers["content-type"]?.[0]?.value?.startsWith(
        "application/json"
      )
    ) {
      let json;

      if (request.body.encoding === "base64") {
        json = JSON.parse(
          Buffer.from(request.body.data, "base64").toString("utf-8")
        );
      } else {
        json = JSON.parse(request.body.data);
      }

      if (json.query) {
        const hash = hashQueryString(json.query, json.extensions);

        return { query: json.query, hash, isValidGraphQlRequest: true };
      }

      return {
        isValidGraphQlRequest: false,
      };
    } else if (request.method === "GET" && request.querystring) {
      const params = new URLSearchParams(request.querystring);
      const extensions = params.get("extensions");

      if (
        extensions &&
        typeof extensions === "string" &&
        extensions.startsWith("{")
      ) {
        const json = JSON.parse(extensions);

        if (!json.persistedQuery?.sha256Hash) {
          return {
            isValidGraphQlRequest: false,
          };
        }

        return {
          isValidGraphQlRequest: true,
          hash: json.persistedQuery?.sha256Hash,
        };
      }
    }
  } catch (e) {
    console.log(e);
  }

  return {
    isValidGraphQlRequest: false,
  };
}

/**
 * @param {import("aws-lambda").CloudFrontRequest} request
 */
export function handleCors(request) {
  if (request.method === "OPTIONS" && request.uri.includes("/graphql")) {
    return {
      status: "200",
      statusDescription: "OK",
      headers: {
        "Access-Control-Allow-Origin": [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
        "Access-Control-Allow-Methods": [
          {
            key: "Access-Control-Allow-Methods",
            value: "POST, GET, OPTIONS",
          },
        ],
        "Access-Control-Allow-Headers": [
          {
            key: "Access-Control-Allow-Headers",
            value: "content-type",
          },
        ],
        "Access-Control-Max-Age": [
          {
            key: "Access-Control-Max-Age",
            value: "86400",
          },
        ],
      },
    };
  }
}
