/**
 * fork:proma-46-mcp-catalog — stdio 目录凭据存储 + 绑定注入的单测。
 *
 * 覆盖「服务器配置被外部改动后不再注入密钥」这条安全线：存进去的凭据只在
 * 当前 command/args 与保存时完全一致时才被 `resolveCatalogCredentialEnvironment`
 * 交出来。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  readCatalogCredentials,
  removeCatalogCredential,
  resolveCatalogCredentialEnvironment,
  saveCatalogCredential,
} = await createJiti(import.meta.url).import("./mcp-catalog-credentials.ts");
const { createStdioCredentialBinding } = await createJiti(import.meta.url).import("./mcp-catalog.ts");

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), "pi-mcp-catalog-"));
  return { dir, file: join(dir, "mcp-catalog-credentials.json") };
}

test("stdio 凭据往返，且文件是 0600", () => {
  const { dir, file } = tempFile();
  try {
    saveCatalogCredential("brave-search", {
      envName: "BRAVE_API_KEY",
      value: "brave-key",
      binding: createStdioCredentialBinding("npx", ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"]),
    }, { file });
    const record = readCatalogCredentials({ file })["brave-search"];
    assert.equal(record.envName, "BRAVE_API_KEY");
    assert.equal(record.value, "brave-key");
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("绑定一致才注入；command/args 被外部改动后拒绝注入", () => {
  const { dir, file } = tempFile();
  try {
    const args = ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"];
    saveCatalogCredential("brave-search", {
      envName: "BRAVE_API_KEY",
      value: "brave-key",
      binding: createStdioCredentialBinding("npx", args),
    }, { file });
    assert.deepEqual(
      resolveCatalogCredentialEnvironment("brave-search", { command: "npx", args }, { file }),
      { BRAVE_API_KEY: "brave-key" },
    );
    assert.equal(
      resolveCatalogCredentialEnvironment("brave-search", { command: "node", args }, { file }),
      undefined,
      "命令被改即不注入",
    );
    assert.equal(
      resolveCatalogCredentialEnvironment("brave-search", { command: "npx", args: ["-y", "evil"] }, { file }),
      undefined,
      "参数被改即不注入",
    );
    assert.equal(resolveCatalogCredentialEnvironment("other", { command: "npx", args }, { file }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("坏文件按空表处理，删除只删指定 server", () => {
  const { dir, file } = tempFile();
  try {
    writeFileSync(file, "{ not json", "utf8");
    assert.deepEqual(readCatalogCredentials({ file }), {});
    saveCatalogCredential("a", { envName: "A", value: "1", binding: createStdioCredentialBinding("x", []) }, { file });
    saveCatalogCredential("b", { envName: "B", value: "2", binding: createStdioCredentialBinding("y", []) }, { file });
    assert.equal(removeCatalogCredential("a", { file }), true);
    assert.equal(removeCatalogCredential("a", { file }), false);
    assert.deepEqual(Object.keys(readCatalogCredentials({ file })), ["b"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
