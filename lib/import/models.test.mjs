import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  MODELS_MAX_CANDIDATES,
  MODELS_MAX_FILE_BYTES,
  parseTomlTables,
  scanModelImports,
} = await jiti.import("./models.ts");

function fixtureHome(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-import-models-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("claude settings: provider parsed and key never serialized", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-models-claude-11aa";
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    env: {
      ANTHROPIC_API_KEY: secret,
      ANTHROPIC_BASE_URL: "https://api.example.com",
      ANTHROPIC_MODEL: "claude-sonnet-4",
    },
  }));

  const result = await scanModelImports({ home });
  const candidate = result.candidates.find((entry) => entry.id === "claude:default");
  assert.ok(candidate);
  assert.equal(candidate.baseUrl, "https://api.example.com");
  assert.equal(candidate.apiStyle, "anthropic_messages");
  assert.deepEqual(candidate.modelIds, ["claude-sonnet-4"]);
  assert.equal(candidate.hasSecret, true);
  assert.equal(candidate.destination, join(home, ".pi", "agent", "models.json"));
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("codex TOML: model_providers parse with env_key and inline api_key", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-models-codex-22bb";
  write(join(home, ".codex", "config.toml"), [
    "model = \"gpt-5\"",
    "",
    "[model_providers.local]",
    "name = \"Local Provider\"",
    "base_url = \"http://localhost:1234/v1\"",
    "wire_api = \"responses\"",
    `api_key = "${secret}"`,
    "",
    "[model_providers.env-provider]",
    "base_url = \"https://env.example.com/v1\"",
    "env_key = \"ENV_PROVIDER_KEY\"",
    "",
  ].join("\n"));

  const result = await scanModelImports({ home });
  const local = result.candidates.find((entry) => entry.id === "codex:local");
  const envProvider = result.candidates.find((entry) => entry.id === "codex:env-provider");
  assert.ok(local);
  assert.equal(local.name, "Local Provider");
  assert.equal(local.baseUrl, "http://localhost:1234/v1");
  assert.equal(local.apiStyle, "responses");
  assert.deepEqual(local.modelIds, ["gpt-5"]);
  assert.equal(local.hasSecret, true);
  assert.ok(envProvider);
  assert.equal(envProvider.hasSecret, true);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("opencode: auth.json drives hasSecret and the key never serialized", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-models-opencode-33cc";
  write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({
    provider: {
      gateway: {
        name: "Gateway",
        options: { baseURL: "https://oc.example.com/v1" },
        models: { "gpt-4o": {}, "gpt-4o-mini": {} },
      },
    },
  }));
  write(join(home, ".config", "opencode", "auth.json"), JSON.stringify({
    gateway: { type: "api", key: secret },
  }));

  const result = await scanModelImports({ home });
  const candidate = result.candidates.find((entry) => entry.id === "opencode:gateway");
  assert.ok(candidate);
  assert.equal(candidate.name, "Gateway");
  assert.equal(candidate.baseUrl, "https://oc.example.com/v1");
  assert.deepEqual(candidate.modelIds, ["gpt-4o", "gpt-4o-mini"]);
  assert.equal(candidate.hasSecret, true);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("pi models.json: provider with models and apiKey", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-models-pi-44dd";
  write(join(home, ".pi", "agent", "models.json"), JSON.stringify({
    providers: {
      "my-provider": {
        name: "My Provider",
        baseUrl: "https://pi.example.com/v1",
        api: "anthropic-messages",
        apiKey: secret,
        models: [{ id: "model-a" }, { id: "model-b" }, { id: "model-a" }],
      },
    },
  }));

  const result = await scanModelImports({ home });
  const candidate = result.candidates.find((entry) => entry.id === "pi:my-provider");
  assert.ok(candidate);
  assert.equal(candidate.apiStyle, "anthropic_messages");
  assert.deepEqual(candidate.modelIds, ["model-a", "model-b"]);
  assert.equal(candidate.hasSecret, true);
  assert.equal(candidate.destination, join(home, ".pi", "agent", "models.json"));
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("credential-looking URL userinfo is redacted from baseUrl", async (t) => {
  const home = fixtureHome(t);
  const secret = "sk-test-models-url-55ee";
  write(join(home, ".claude", "settings.json"), JSON.stringify({
    model: "claude-sonnet-4",
    env: { ANTHROPIC_BASE_URL: `https://user:${secret}@api.example.com/v1` },
  }));

  const result = await scanModelImports({ home });
  const candidate = result.candidates.find((entry) => entry.id === "claude:default");
  assert.ok(candidate);
  assert.equal(candidate.baseUrl, "https://api.example.com/v1");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("missing and malformed stores are diagnostics, not exceptions", async (t) => {
  const home = fixtureHome(t);

  const missing = await scanModelImports({ home });
  assert.deepEqual(missing.candidates, []);
  assert.equal(missing.sources.length, 5);
  assert.equal(missing.sources.every((source) => source.exists === false), true);

  const secret = "sk-test-models-broken-66ff";
  write(join(home, ".pi", "agent", "models.json"), `{"providers":{"x":{"apiKey":"${secret}"`);
  const malformed = await scanModelImports({ home });
  const broken = malformed.sources.find((source) => source.source === "pi");
  assert.ok(broken);
  assert.equal(broken.exists, true);
  assert.equal(broken.error, "malformed JSON");
  assert.ok(!JSON.stringify(malformed).includes(secret));
});

test(`TOML subset handles arrays and quoted tables`, () => {
  const parsed = parseTomlTables([
    "[model_providers.\"quoted-name\"]",
    "base_url = \"https://x.example.com\"",
    "models = [\"a\", \"b\"]",
    "env = { KEY = \"value\", FLAG = true }",
  ].join("\n"));
  const table = parsed.tables.get("model_providers.quoted-name");
  assert.ok(table);
  assert.deepEqual(table.models, ["a", "b"]);
  assert.deepEqual(table.env, { KEY: "value", FLAG: true });
});

test(`files above the ${MODELS_MAX_FILE_BYTES}-byte guard are reported, not parsed`, async (t) => {
  const home = fixtureHome(t);
  write(join(home, ".pi", "agent", "models.json"), " ".repeat(MODELS_MAX_FILE_BYTES + 1));
  const result = await scanModelImports({ home });
  assert.deepEqual(result.candidates, []);
  const piDiagnostic = result.sources.find((source) => source.source === "pi");
  assert.ok(piDiagnostic);
  assert.equal(piDiagnostic.exists, true);
  assert.equal(piDiagnostic.error, "file too large");
});

test(`the ${MODELS_MAX_CANDIDATES}-candidate ceiling holds and reports truncation`, async (t) => {
  const home = fixtureHome(t);
  const providers = {};
  const total = MODELS_MAX_CANDIDATES + 5;
  for (let index = 0; index < total; index += 1) {
    providers[`provider-${String(index).padStart(4, "0")}`] = {
      options: { baseURL: `https://p${index}.example.com/v1` },
      models: { "model-a": {} },
    };
  }
  write(join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ provider: providers }));

  const result = await scanModelImports({ home });
  assert.equal(result.candidates.length, MODELS_MAX_CANDIDATES);
  const opencodeDiagnostic = result.sources.find(
    (source) => source.source === "opencode" && source.path.endsWith("opencode.json"),
  );
  assert.ok(opencodeDiagnostic);
  assert.equal(opencodeDiagnostic.truncated, true);
});
