import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.ts";
import { createCloud } from "./server.ts";

/**
 * The executable entry point.
 *
 * Everything host-shaped is decided here and nowhere deeper: where the environment comes from,
 * where the document lives, and the signals that shut the process down.
 */
const config = loadConfig(process.env, { dataFile: join(homedir(), ".pinext-cloud", "cloud.json") });
config.dataFile = resolve(config.dataFile);

const cloud = await createCloud(config);
const address = await cloud.listen();
console.log(`[cloud] listening on ${address.host}:${address.port}`);
console.log(`[cloud] public origin ${config.publicOrigin}`);
console.log(`[cloud] data ${config.dataFile}`);
console.log(`[cloud] sign-in ${config.github ? "github" : config.devLogin ? "dev (no github)" : "DISABLED — set GITHUB_CLIENT_ID/SECRET or DEV_LOGIN=1"}`);
console.log(`[cloud] turn ${config.turn ? `${config.turn.urls.length} url(s)` : "none (stun only)"}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void cloud.close().finally(() => process.exit(0));
  });
}
