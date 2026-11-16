// fork:lan-pair-qr —— vendor 来的 QR 编码器。
// 黄金向量沿用 MusePi 的 `packages/coding-agent/test/utils/qrcode.test.ts`：那边是与
// `qrcode` 参考库逐字节对拍、并用 jsQR 真解过的，所以这里既能守住「不被改坏」，也能
// 守住「这台机器上的 vendor 代码就是可用的那份」。指纹算法照抄（按行拼 bit 串取
// sha256 前 16 位），只把 Bun 的 hasher 换成 node:crypto。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const { QrCode, renderQrHalfBlocks } = await createJiti(import.meta.url).import("./qrcode.ts");

function fingerprint(qr) {
  let bits = "";
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) bits += qr.module(x, y) ? "1" : "0";
  return createHash("sha256").update(bits).digest("hex").slice(0, 16);
}

const VECTORS = [
  { text: "HELLO WORLD", ecl: "M", mask: 0, version: 1, size: 21, hash: "a28227450c6dd5ab" },
  {
    text: "https://my.omp.sh/#mgAYTZwEnpRQtca0CTgn-Q.gdJU",
    ecl: "M",
    mask: 4,
    version: 4,
    size: 33,
    hash: "4af2f66e1b06a5b1",
  },
  {
    text: "https://web.example/collab/#relay.example.com:8443/r/AbCdEfGhIjKlMnOp.0123456789abcdef",
    ecl: "Q",
    mask: 6,
    version: 7,
    size: 45,
    hash: "2ca4a51e3cba1adf",
  },
  { text: "x", ecl: "L", mask: 1, version: 1, size: 21, hash: "d1330f755ac63f88" },
];

test("vendor 来的编码器逐字节没漂移", () => {
  for (const vector of VECTORS) {
    const qr = QrCode.encodeText(vector.text, vector.ecl, { mask: vector.mask });
    assert.equal(qr.version, vector.version, vector.text);
    assert.equal(qr.size, vector.size, vector.text);
    assert.equal(qr.mask, vector.mask, vector.text);
    assert.equal(fingerprint(qr), vector.hash, vector.text);
  }
});

test("自动选最小版本", () => {
  // byte mode + EC M：v1=14、v2=26、v3=42 数据字节。
  assert.equal(QrCode.encodeText("a".repeat(14), "M").version, 1);
  assert.equal(QrCode.encodeText("a".repeat(15), "M").version, 2);
  assert.equal(QrCode.encodeText("a".repeat(26), "M").version, 2);
  assert.equal(QrCode.encodeText("a".repeat(27), "M").version, 3);
});

test("按 UTF-8 字节长度定量，不是按字符数", () => {
  assert.equal(QrCode.encodeText("日".repeat(5), "M").version, 2);
});

test("不指定 mask 时确定性地选罚分最低的那个", () => {
  const qr = QrCode.encodeText("https://my.omp.sh/#demo", "M");
  assert.equal(qr.mask, 1);
  assert.equal(fingerprint(qr), "ee820c588fe36d99");
});

test("超过版本 40 明确抛错", () => {
  assert.throws(() => QrCode.encodeText("a".repeat(1274), "H"), /too long/);
});

test("三个定位图形在三个角上", () => {
  const qr = QrCode.encodeText("finder", "M");
  const finderCorner = (ox, oy) =>
    qr.module(ox, oy) && !qr.module(ox + (ox === 0 ? 1 : -1), oy + (oy === 0 ? 1 : -1));
  assert.equal(finderCorner(0, 0), true);
  assert.equal(finderCorner(qr.size - 1, 0), true);
  assert.equal(finderCorner(0, qr.size - 1), true);
});

test("本仓真会编码的那条链接（http + 局域网址 + #6 位码）编得出来且够扫", () => {
  const link = "http://192.168.43.6:30143/pair#135793";
  const qr = QrCode.encodeText(link, "M");
  assert.equal(qr.size, 4 * qr.version + 17);
  // 版本 3 及以上要用 16 位字符计数，不能被截断。
  assert.ok(qr.version >= 3, `expected v>=3 for a 36-char URL, got v${qr.version}`);
});

test("半块 ANSI 渲染器给出能扫的静区", () => {
  const qr = QrCode.encodeText("https://omp.sh/#demo", "M");
  const margin = 3;
  const lines = renderQrHalfBlocks(qr, { margin });
  const stripped = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
  assert.equal(stripped[0].length, qr.size + margin * 2);
  const quietRows = Math.floor(margin / 2);
  for (let i = 0; i < quietRows; i++) assert.equal(stripped[i], " ".repeat(qr.size + margin * 2));
  assert.match(lines[quietRows + 2], /\x1b\[47m/);
  assert.match(lines[quietRows + 2], /[▀▄█]/);
  assert.equal(lines.length, Math.ceil((qr.size + margin * 2) / 2));
});
