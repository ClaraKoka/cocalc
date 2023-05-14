// NOTE/TODO: there is a grpc client that is faster, but it is "work in progress",
// so we're waiting and will switch later.
// See https://github.com/qdrant/qdrant-js/blob/master/packages/js-client-rest/src/qdrant-client.ts
import { QdrantClient } from "@qdrant/js-client-rest";
import { getServerSettings } from "@cocalc/server/settings/server-settings";
import { promises as fs } from "fs";
import { getLogger } from "@cocalc/backend/logger";
const log = getLogger("database:qdrant");

export const COLLECTION_NAME = "cocalc";
const SIZE = 1536; // that's for the openai embeddings api

const clientCache: { [key: string]: QdrantClient } = {};
export async function getClient(): Promise<QdrantClient> {
  let {
    neural_search_enabled,
    kucalc,
    qdrant_cluster_url: url,
    qdrant_api_key: apiKey,
  } = await getServerSettings();

  if (!neural_search_enabled) {
    log.debug("getClient - not enabled");
    throw Error("Qdrant neural search is not enabled.");
  }
  const key = `${url}-${apiKey}`;
  if (clientCache[key]) {
    // we return client that matches the configuration in the database. If you change config
    // in database, then you get a different client as soon as getServerSettings() updates.
    return clientCache[key];
  }

  if (!url && !apiKey && kucalc) {
    // There is special case fallback config on kucalc.  If the
    // directory /secrets/qdrant/qdrant exists *AND* no apiKey is set,
    // then the api key is the contents of that file (trimmed),
    // and the server has hostname "qdrant".
    // We only do this check on kucalc and when the api key and url
    // are not set, because of course you can also use an external
    // server (e.g., https://cloud.qdrant.io/) even with kucalc.
    // This is all so you don't have to find and copy/paste the
    // autogenerated kucalc api key.
    apiKey = await kucalcApiKey();
    log.debug("getClient - kucalc apiKey defined:", apiKey.length > 0);
    if (apiKey) {
      url = "http://qdrant:6333";
    }
  }

  if (!url) {
    throw Error("Qdrant Cluster URL not configured");
  }
  log.debug("getClient -- using url = ", url);

  // don't necessarily require apiKey to be nontrivial, e.g., not needed locally for dev purposes.
  // We polyfill fetch so cocalc still works with node 16.  With node 18 this isn't needed.
  // Node 16 is end-of-life soon and we will stop supporting it.
  if (global.Headers == null) {
    log.debug("getClient -- patching in node-fetch");
    const { default: fetch, Headers } = await import("node-fetch");
    global.Headers = Headers;
    global.fetch = fetch;
  }
  // NOTE: the client seems to do a good job autoreconnecting even if the
  // database is stopped and started.
  const client = new QdrantClient({
    url,
    ...(apiKey ? { apiKey } : undefined),
  });
  await init(client);
  clientCache[key] = client;
  return client;
}

async function createIndexes(client) {
  log.debug("createIndex");
  // It seems fine to just call this frequently.
  // There also might not be any way currently to know whether this index exists.
  // Note that it was only a few months ago when indexes got added to qdrant!
  await client.createPayloadIndex(COLLECTION_NAME, {
    field_name: "url",
    field_schema: {
      type: "text",
      tokenizer: "prefix",
      min_token_len: 2,
      //  should be more than enough, since the maximum length of a filename is 255 characters; the url field is
      // of the form "\projects/project_id/files/[filename]#fragmentid", so should easily fit in 1000 characters.
      max_token_len: 1000,
      lowercase: false,
    },
  });
}

async function createCollection(client) {
  log.debug("createCollection");
  // define our schema.
  await client.createCollection(COLLECTION_NAME, {
    vectors: {
      size: SIZE,
      distance: "Cosine", // pretty standard to use cosine
    },
    // Use quantization to massively reduce memory and space requirements, as explained here:
    // see https://qdrant.tech/documentation/quantization/#setting-up-scalar-quantization
    quantization_config: {
      scalar: {
        type: "int8",
        quantile: 0.99,
        always_ram: false,
      },
    },
  });
}

async function init(client) {
  log.debug("init");
  const { collections } = await client.getCollections();
  const collectionNames = collections.map((collection) => collection.name);
  if (!collectionNames.includes(COLLECTION_NAME)) {
    await createCollection(client);
  }
  await createIndexes(client);
}

export type Payload =
  | { [key: string]: unknown }
  | Record<string, unknown>
  | null
  | undefined;

export interface Point {
  id: string | number;
  vector: number[];
  payload?: Payload;
}

export async function upsert(data: Point[]) {
  log.debug("upsert");
  const client = await getClient();
  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: data,
  });
}

export async function search({
  id,
  vector,
  limit,
  filter,
  selector,
  offset,
}: {
  vector?: number[];
  id?: string | number;
  limit: number;
  filter?: object;
  selector?;
  offset?: number;
}) {
  log.debug("search; filter=", filter);
  const client = await getClient();
  if (id) {
    return await client.recommend(COLLECTION_NAME, {
      positive: [id],
      limit,
      filter,
      with_payload: selector == null ? true : selector,
      offset,
    });
  } else if (vector) {
    return await client.search(COLLECTION_NAME, {
      vector,
      limit,
      filter,
      with_payload: selector == null ? true : selector,
      offset,
    });
  } else {
    throw Error("id or vector must be specified");
  }
}

export async function scroll({
  limit,
  filter,
  selector,
  offset,
}: {
  limit: number;
  filter: object;
  selector?;
  offset?: number | string;
}) {
  log.debug("scroll; filter=", filter);
  const client = await getClient();
  return await client.scroll(COLLECTION_NAME, {
    limit,
    filter,
    with_payload: selector == null ? true : selector,
    offset,
  });
}

export async function getPoints(opts): Promise<any> {
  const client = await getClient();
  const result = await client
    .api("points")
    .getPoints({ collection_name: COLLECTION_NAME, ...opts });
  return result.data.result;
}

export async function deletePoints(opts): Promise<any> {
  log.debug("deletePoints=");
  const client = await getClient();
  const result = await client
    .api("points")
    .deletePoints({ collection_name: COLLECTION_NAME, ...opts });
  return result.data.result;
}

// Read the file /secrets/qdrant/qdrant, convert that
// to a string and trim it and return it.:
async function kucalcApiKey(): Promise<string> {
  try {
    const data = await fs.readFile("/secrets/qdrant/qdrant");
    return data.toString().trim();
  } catch (_err) {
    return "";
  }
}
