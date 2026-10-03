import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * fork:proma-53 — 最小 ZIP 读写层（docx / xlsx / pptx 都是 ZIP 容器）。
 *
 * WHY 自己写：`docx` / `exceljs` / `pptxgenjs` 都不在依赖表里，而 OOXML 的容器
 * 本身只是 deflate + 一个 22 字节的本地头 / 46 字节的中心目录条目。Node 自带的
 * `zlib` 提供 deflate/inflate，于是 200 行就能读**和**写一个普通 ZIP，不必为一个
 * zip 容器引入依赖（Proma 那边用 `adm-zip` + `xmldom`，本仓不允许新增依赖）。
 *
 * 支持范围（超出就抛 `DocumentZipError`，绝不猜）：
 *   - 压缩方法 0（stored）与 8（deflate）；
 *   - 通用位标记 3（data descriptor）：大小一律取中心目录里的值，所以带描述符的
 *     条目照样读得对；
 *   - 通用位标记 11（UTF-8 文件名）。
 * 不支持：加密（位标记 0）、Zip64、多盘。遇到就报明确的中文原因，调用方把它
 * 直接转成给模型看的错误信息。
 *
 * 纯函数（Buffer 进、Buffer 出），因此可以脱离文件系统单测。
 */

export class DocumentZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentZipError";
  }
}

export interface ZipEntry {
  name: string;
  /** 写入端可以直接给 UTF-8 文本；读回来的条目一律是 Buffer。 */
  data: Buffer | string;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const MAX_COMMENT_LENGTH = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** 标准 CRC-32（与 `zip` / `unzip` 同一多项式），值域与 Java 的 `CRC32.getValue()` 相同。 */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - MAX_COMMENT_LENGTH - 22);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new DocumentZipError("不是有效的 ZIP 容器（找不到中央目录结尾记录）");
}

/**
 * 读出全部条目。目录项会被归一化成不含 `/` 的相对路径并按原样保留大小写；
 * 同名条目后者覆盖前者（OOXML 容器里不会同名，重复即损坏）。
 */
export function readZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22) throw new DocumentZipError("文件太短，不是 ZIP 容器");
  const endOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);

  if (buffer.readUInt32LE(endOffset - 20) === ZIP64_LOCATOR_SIGNATURE) {
    throw new DocumentZipError("不支持 Zip64 容器");
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw new DocumentZipError("ZIP 中央目录越界，文件可能已损坏");
  }

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new DocumentZipError("ZIP 中央目录条目损坏");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    if (flags & 0x1) throw new DocumentZipError(`ZIP 条目已加密，无法读取：${name}`);
    if (name.endsWith("/")) {
      // 目录条目没有数据，直接跳过。
    } else {
      entries.push({ name, data: readEntryData(buffer, localOffset, method, compressedSize, uncompressedSize, name) });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(
  buffer: Buffer,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
  name: string,
): Buffer {
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new DocumentZipError(`ZIP 条目 ${name} 的本地头损坏`);
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > buffer.length) throw new DocumentZipError(`ZIP 条目 ${name} 的数据越界`);
  const raw = buffer.subarray(dataStart, dataEnd);

  if (method === 0) return Buffer.from(raw);
  if (method === 8) {
    try {
      const inflated = inflateRawSync(raw);
      return uncompressedSize > 0 && inflated.length !== uncompressedSize ? inflated.subarray(0, uncompressedSize) : inflated;
    } catch {
      throw new DocumentZipError(`ZIP 条目 ${name} 的 deflate 数据损坏`);
    }
  }
  throw new DocumentZipError(`ZIP 条目 ${name} 使用了不支持的压缩方法 ${method}`);
}

/** 容器里有没有某个部件（OOXML 的部件名区分大小写）。 */
export function zipEntryNames(buffer: Buffer): string[] {
  return readZipEntries(buffer).map((entry) => entry.name);
}

function deflateOrStore(data: Buffer): { method: number; payload: Buffer } {
  const deflated = deflateRawSync(data, { level: 9 });
  return deflated.length < data.length ? { method: 8, payload: deflated } : { method: 0, payload: data };
}

/**
 * 写一个 ZIP 容器：本地头 + deflate/stored + 中心目录 + EOCD，不带 data descriptor
 * （大小在写之前就知道，不需要流式那套）。
 */
export function writeZipEntries(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const content = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data;
    const nameBytes = Buffer.from(entry.name, "utf8");
    // OOXML 的部件名基本都是 ASCII；出现非 ASCII 部件名时置通用位标记 11。
    const utf8Flag = /[^\x20-\x7e]/.test(entry.name) ? 0x800 : 0;
    const { method, payload } = deflateOrStore(content);
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date: 1980-01-01
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBytes, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const central = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, central, end]);
}



/** 按名字取一个部件，取不到返回 undefined（调用方给具体报错）。 */
export function zipEntry(entries: ZipEntry[], name: string): Buffer | undefined {
  const data = entries.find((entry) => entry.name === name)?.data;
  return data === undefined ? undefined : typeof data === "string" ? Buffer.from(data, "utf8") : data;
}

/** 按名字取一个部件的 UTF-8 文本，取不到返回 undefined。 */
export function zipText(entries: ZipEntry[], name: string): string | undefined {
  return zipEntry(entries, name)?.toString("utf8");
}

/** 替换 / 追加一个部件，其余条目按原顺序保留（顺序对 OOXML 无关，但保持稳定便于比对）。 */
export function withZipEntry(entries: ZipEntry[], name: string, data: Buffer | string): ZipEntry[] {
  const replacement: ZipEntry = {
    name,
    data: typeof data === "string" ? Buffer.from(data, "utf8") : data,
  };
  const index = entries.findIndex((entry) => entry.name === name);
  if (index < 0) return [...entries, replacement];
  return entries.map((entry, position) => (position === index ? replacement : entry));
}