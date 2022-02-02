import { createHash } from "crypto";

/**
 * This is the same hashing algorithm as APQ, so if the request is an APQ request
 * we'll just use that.
 *
 * @param {string} query
 * @param {{ [key: string]: any }} extensions
 */
export function hashQueryString(query, extensions) {
  if (extensions?.persistedQuery?.sha256Hash) {
    return extensions.persistedQuery.sha256Hash;
  }

  return createHash("sha256").update(query).digest("hex");
}
