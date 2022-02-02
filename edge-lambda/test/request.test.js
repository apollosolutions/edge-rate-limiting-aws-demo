import { getQueryFromRequest } from "../request.js";

test("non-graphql GET", () => {
  expect(
    getQueryFromRequest({
      clientIp: "123",
      headers: {},
      method: "GET",
      querystring: "",
      uri: "/",
      body: undefined,
      origin: undefined,
    })
  ).toEqual({
    isValidGraphQlRequest: false,
  });
});

test("APQ GET", () => {
  expect(
    getQueryFromRequest({
      clientIp: "123",
      headers: {},
      method: "GET",
      querystring: `?extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`,
      uri: "http://localhost:4000/graphql",
      body: undefined,
      origin: undefined,
    })
  ).toEqual({
    hash: "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38",
    isValidGraphQlRequest: true,
  });
});

test("non-graphql POST", () => {
  expect(
    getQueryFromRequest({
      clientIp: "123",
      headers: {
        "content-type": [{ key: "content-type", value: "application/json" }],
      },
      method: "POST",
      querystring: ``,
      uri: "http://localhost:4000/graphql",
      body: {
        action: "read-only",
        inputTruncated: false,
        encoding: "base64",
        data: "",
      },
      origin: undefined,
    })
  ).toEqual({
    isValidGraphQlRequest: false,
  });
});

test("graphql POST", () => {
  expect(
    getQueryFromRequest({
      clientIp: "123",
      headers: {
        "content-type": [{ key: "content-type", value: "application/json" }],
      },
      method: "POST",
      querystring: ``,
      uri: "http://localhost:4000/graphql",
      body: {
        action: "read-only",
        inputTruncated: false,
        encoding: "base64",
        data: Buffer.from(JSON.stringify({ query: "{__typename}" })).toString(
          "base64"
        ),
      },
      origin: undefined,
    })
  ).toEqual({
    hash: "ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38",
    isValidGraphQlRequest: true,
    query: "{__typename}",
  });
});

test("graphql POST with APQ", () => {
  expect(
    getQueryFromRequest({
      clientIp: "123",
      headers: {
        "content-type": [{ key: "content-type", value: "application/json" }],
      },
      method: "POST",
      querystring: ``,
      uri: "http://localhost:4000/graphql",
      body: {
        action: "read-only",
        inputTruncated: false,
        encoding: "base64",
        data: Buffer.from(
          JSON.stringify({
            query: "{__typename}",
            extensions: {
              persistedQuery: {
                version: 1,
                sha256Hash: "client-specified hash",
              },
            },
          })
        ).toString("base64"),
      },
      origin: undefined,
    })
  ).toEqual({
    hash: "client-specified hash",
    isValidGraphQlRequest: true,
    query: "{__typename}",
  });
});
