import { XmlParts, drawingRuns, escapeXmlText, xmlAttr } from "./document-xml";
import { DocumentZipError, readZipEntries, withZipEntry, writeZipEntries, zipText, type ZipEntry } from "./document-zip";

/**
 * fork:proma-53 — PresentationML（.pptx）的最小实现：新建演示 / 读每页标题与要点 /
 * 改某页的标题与要点。
 *
 * 版式决定（这决定了实现能不能只有 300 行）：母版 + **空白版式** + 幻灯片上两个
 * 绝对定位的文本框（标题 + 正文）。不用占位符继承，于是 slide1.xml 自己就长这样，
 * 不用去解母版的继承链。代价是没有「标题页 / 正文页」两套版式切换；收益是读改
 * 写都只碰那一个 `<p:txBody>`，母版/版式/主题原样写回。
 *
 * 仍然要写 theme1.xml / slideMaster1.xml / slideLayout1.xml：PowerPoint 拒绝打开
 * 缺这三件套的文件（LibreOffice 更宽松）。它们是固定的样板，不随内容变化。
 */

export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFormatError";
  }
}

export class DocumentSlideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentSlideError";
  }
}

export interface PptxSlideInput {
  title: string;
  bullets?: string[];
}

export interface PptxSlideSummary {
  /** 0 起，按 `presentation.xml` 的 `p:sldIdLst` 顺序（也就是放映顺序）。 */
  index: number;
  title: string;
  bullets: string[];
}

export interface PptxReadResult {
  title: string;
  slides: PptxSlideSummary[];
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

// 16:9 幻灯片（12192000 × 6858000 EMU）。文本框位置也按这个坐标系。
const SLIDE_WIDTH = 12_192_000;
const SLIDE_HEIGHT = 6_858_000;
const TITLE_BOX = { x: 838_200, y: 685_800, width: 10_515_600, height: 1_371_600 };
const BODY_BOX = { x: 838_200, y: 2_286_000, width: 10_515_600, height: 3_810_000 };

// ─────────────────────────── 样板部件 ───────────────────────────

function themeXml(): string {
  const fill = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  const line = `<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  const effect = `<a:effectStyle><a:effectLst/></a:effectStyle>`;
  return `${XML_DECLARATION}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="pi-web"><a:themeElements><a:clrScheme name="pi-web"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="pi-web"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="pi-web"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${line}${line}${line}</a:lnStyleLst><a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function slideMasterXml(): string {
  const group = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;
  return `${XML_DECLARATION}<p:sldMaster ${P_NS} ${A_NS} ${R_NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${group}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
}

function slideLayoutXml(): string {
  const group = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;
  return `${XML_DECLARATION}<p:sldLayout ${P_NS} ${A_NS} ${R_NS} type="blank" preserve="1"><p:cSld name="Blank">${group}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

// ─────────────────────────── 幻灯片 ───────────────────────────

function titleShapeXml(text: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${TITLE_BOX.x}" y="${TITLE_BOX.y}"/><a:ext cx="${TITLE_BOX.width}" cy="${TITLE_BOX.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${titleBodyXml(text)}</p:sp>`;
}

function bodyShapeXml(bullets: string[]): string {
  const paragraphs = bullets.length > 0 ? bullets : [""];
  return `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${BODY_BOX.x}" y="${BODY_BOX.y}"/><a:ext cx="${BODY_BOX.width}" cy="${BODY_BOX.height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>${bodyTextBodyXml(bullets)}</p:sp>`;
}

function titleBodyXml(text: string): string {
  const run = `<a:r><a:rPr lang="en-US" sz="4000" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>${escapeXmlText(text)}</a:t></a:r>`;
  return `<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p>${run}</a:p></p:txBody>`;
}

function bodyTextBodyXml(bullets: string[]): string {
  const paragraphs = (bullets.length > 0 ? bullets : [""]).map((bullet) => {
    if (bullet === "") return `<a:p><a:endParaRPr lang="en-US"/></a:p>`;
    const runs = drawingRuns(bullet).replace(/<a:rPr lang="en-US" dirty="0"\/>/g, '<a:rPr lang="en-US" sz="2400"/>');
    return `<a:p><a:pPr marL="342900" indent="-342900"><a:buChar char="•"/></a:pPr>${runs}</a:p>`;
  });
  return `<p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs.join("")}</p:txBody>`;
}

function slideXml(slide: PptxSlideInput): string {
  const group = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
  return `${XML_DECLARATION}<p:sld ${P_NS} ${A_NS} ${R_NS}><p:cSld>${group}${titleShapeXml(slide.title)}${bodyShapeXml(slide.bullets ?? [])}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function presentationXml(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_unused, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  return `${XML_DECLARATION}<p:presentation ${P_NS} ${A_NS} ${R_NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides}</p:sldIdLst><p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/><p:notesSz cx="${SLIDE_HEIGHT}" cy="${SLIDE_WIDTH}"/></p:presentation>`;
}

// ─────────────────────────── 新建 ───────────────────────────

export function buildPresentation(slides: PptxSlideInput[], options: { title?: string } = {}): Buffer {
  const normalized = slides.length > 0 ? slides : [{ title: "" }];
  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${normalized
        .map((_slide, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="${SLIDE_CONTENT_TYPE}"/>`)
        .join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${OFFICE_REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${normalized
        .map((_slide, index) => `<Relationship Id="rId${index + 2}" Type="${OFFICE_REL}/slide" Target="slides/slide${index + 1}.xml"/>`)
        .join("")}<Relationship Id="rIdTheme" Type="${OFFICE_REL}/theme" Target="theme/theme1.xml"/></Relationships>`,
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${OFFICE_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}/theme" Target="../theme/theme1.xml"/></Relationships>`,
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${OFFICE_REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
    },
    ...normalized.map((slide, index) => ({
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      data: `${XML_DECLARATION}<Relationships ${REL_NS}><Relationship Id="rId1" Type="${OFFICE_REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
    })),
    {
      name: "ppt/presentation.xml",
      data: presentationXml(normalized.length),
    },
    { name: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml() },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml() },
    { name: "ppt/theme/theme1.xml", data: themeXml() },
    {
      name: "docProps/core.xml",
      data: `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXmlText(options.title ?? "")}</dc:title><dc:creator>pi-web</dc:creator><cp:lastModifiedBy>pi-web</cp:lastModifiedBy></cp:coreProperties>`,
    },
    ...normalized.map((slide, index) => ({ name: `ppt/slides/slide${index + 1}.xml`, data: slideXml(slide) })),
  ];
  return writeZipEntries(entries);
}

// ─────────────────────────── 读 ───────────────────────────

interface SlideShape {
  name: string;
  placeholder: string | null;
  paragraphs: string[];
}

function parseSlideShapes(xml: string): SlideShape[] {
  const parts = new XmlParts(xml);
  const tree = parts.first("p:spTree");
  if (!tree) return [];
  const shapes: SlideShape[] = [];
  for (const shape of parts.children("p:sp", tree)) {
    const nonVisual = parts.first("p:nvSpPr", shape.innerStart, shape.innerEnd);
    const properties = nonVisual ? parts.first("p:cNvPr", nonVisual.innerStart, nonVisual.innerEnd) : undefined;
    const name = properties ? xmlAttr(properties.attrs, "name") ?? "" : "";
    const placeholder = nonVisual
      ? parts.first("p:ph", nonVisual.innerStart, nonVisual.innerEnd)
      : undefined;
    const placeholderType = placeholder ? xmlAttr(placeholder.attrs, "type") ?? null : null;
    const textBody = parts.first("p:txBody", shape.innerStart, shape.innerEnd);
    const paragraphs: string[] = [];
    if (textBody) {
      for (const paragraph of parts.children("a:p", textBody)) paragraphs.push(paragraphLines(parts, paragraph));
    }
    shapes.push({ name, placeholder: placeholderType, paragraphs });
  }
  return shapes;
}

/** 一个 `a:p` 里的可见文本：run 里的 `a:t`，`a:br` / `a:tab` 还原成换行与制表符。 */
function paragraphLines(parts: XmlParts, paragraph: { innerStart: number; innerEnd: number }): string {
  let text = "";
  for (const node of parts.all(paragraph.innerStart, paragraph.innerEnd)) {
    if (node.name === "a:r") text += parts.text("a:t", node.innerStart, node.innerEnd);
    else if (node.name === "a:br") text += "\n";
    else if (node.name === "a:tab") text += "\t";
  }
  return text;
}

/** 标题 = title/ctrTitle 占位符；没有占位符时退回「第一个有文字的形状」。 */
function titleOf(shapes: SlideShape[]): string {
  const titled = shapes.find((shape) => shape.placeholder === "title" || shape.placeholder === "ctrTitle");
  if (titled) return titled.paragraphs.join("\n");
  const first = shapes.find((shape) => shape.paragraphs.some((line) => line.trim() !== ""));
  return first ? first.paragraphs.join("\n") : "";
}

/** 要点 = body/subTitle 占位符；没有占位符时取「标题之外第一个有文字的形状」。 */
function bulletsOf(shapes: SlideShape[], titleShape: SlideShape | undefined): string[] {
  const body = shapes.find(
    (shape) => shape !== titleShape && (shape.placeholder === "body" || shape.placeholder === "subTitle"),
  );
  const target = body ?? shapes.find((shape) => shape !== titleShape && shape.paragraphs.some((line) => line.trim() !== ""));
  return target ? target.paragraphs.filter((line, index, all) => line.trim() !== "" || all.length === 1) : [];
}

function slideOrder(entries: ZipEntry[]): { partName: string }[] {
  const presentationXmlText = zipText(entries, "ppt/presentation.xml");
  if (!presentationXmlText) throw new DocumentFormatError("不是 PowerPoint 演示（缺少 ppt/presentation.xml）");
  const relsXml = zipText(entries, "ppt/_rels/presentation.xml.rels");
  if (!relsXml) throw new DocumentFormatError("PowerPoint 演示缺少 ppt/_rels/presentation.xml.rels");

  const rels = new XmlParts(relsXml);
  const targets = new Map<string, string>();
  for (const relationship of rels.elements("Relationship")) {
    const id = xmlAttr(relationship.attrs, "Id");
    const target = xmlAttr(relationship.attrs, "Target");
    if (id && target) targets.set(id, `ppt/${target.replace(/^\/?(ppt\/)?/, "")}`);
  }

  const presentation = new XmlParts(presentationXmlText);
  const list = presentation.first("p:sldIdLst");
  if (!list) return [];
  const order: { partName: string }[] = [];
  for (const slideId of presentation.children("p:sldId", list)) {
    const relationId = xmlAttr(slideId.attrs, "r:id");
    const partName = relationId ? targets.get(relationId) : undefined;
    if (partName) order.push({ partName });
  }
  return order;
}

export function readPresentation(buffer: Buffer): PptxReadResult {
  const entries = readZipEntries(buffer);
  const coreXml = zipText(entries, "docProps/core.xml");
  const title = coreXml ? new XmlParts(coreXml).text("dc:title") : "";
  const slides: PptxSlideSummary[] = [];
  for (const { partName } of slideOrder(entries)) {
    const xml = zipText(entries, partName);
    if (!xml) continue;
    const shapes = parseSlideShapes(xml);
    const titleShape = shapes.find((shape) => shape.placeholder === "title" || shape.placeholder === "ctrTitle")
      ?? shapes.find((shape) => shape.paragraphs.some((line) => line.trim() !== ""));
    slides.push({
      index: slides.length,
      title: titleOf(shapes),
      bullets: bulletsOf(shapes, titleShape),
    });
  }
  return { title, slides };
}

// ─────────────────────────── 改 ───────────────────────────

/** 改第 `index` 页（0 起）的标题与 / 或要点；两个字段都是可选的。 */
export function updateSlide(
  buffer: Buffer,
  index: number,
  change: { title?: string; bullets?: string[] },
): Buffer {
  if (change.title === undefined && change.bullets === undefined) {
    throw new DocumentSlideError("没有要改的内容：至少给 title 或 bullets 之一");
  }
  const entries = readZipEntries(buffer);
  const order = slideOrder(entries);
  const slide = order[index];
  if (!slide) {
    throw new DocumentSlideError(`演示里没有第 ${index} 页（共 ${order.length} 页，0 起）`);
  }
  const xml = zipText(entries, slide.partName);
  if (!xml) throw new DocumentFormatError(`演示缺少部件 ${slide.partName}`);

  const parts = new XmlParts(xml);
  const tree = parts.first("p:spTree");
  const shapes = tree ? parts.children("p:sp", tree) : [];
  const withText = shapes.filter((shape) => parts.text("a:t", shape.innerStart, shape.innerEnd).trim() !== "");
  const titleShape = shapes.find((shape) => placeholderOf(parts, shape) === "title" || placeholderOf(parts, shape) === "ctrTitle")
    ?? withText[0];
  const bodyShape = shapes.find((shape) => shape !== titleShape && (placeholderOf(parts, shape) === "body" || placeholderOf(parts, shape) === "subTitle"))
    ?? withText.find((shape) => shape !== titleShape)
    ?? shapes.find((shape) => shape !== titleShape);

  const edits: { start: number; end: number; xml: string }[] = [];
  if (change.title !== undefined && titleShape) {
    const textBody = parts.first("p:txBody", titleShape.innerStart, titleShape.innerEnd);
    if (textBody) edits.push({ start: textBody.start, end: textBody.end, xml: titleBodyXml(change.title) });
  }
  if (change.bullets !== undefined && bodyShape) {
    const textBody = parts.first("p:txBody", bodyShape.innerStart, bodyShape.innerEnd);
    if (textBody) {
      const clash = edits.some((edit) => edit.start === textBody.start);
      if (clash) throw new DocumentSlideError("这一页只有一个文本框，不能同时设置标题和要点");
      edits.push({ start: textBody.start, end: textBody.end, xml: bodyTextBodyXml(change.bullets) });
    }
  }
  if (edits.length === 0) throw new DocumentSlideError("这一页里没有可写的文本框");

  // 从后往前替换，前面的偏移才不会被后面的替换挪动。
  edits.sort((left, right) => right.start - left.start);
  let document = xml;
  for (const edit of edits) document = document.slice(0, edit.start) + edit.xml + document.slice(edit.end);
  return writeZipEntries(withZipEntry(entries, slide.partName, document));
}

function placeholderOf(parts: XmlParts, shape: { innerStart: number; innerEnd: number }): string | null {
  const nonVisual = parts.first("p:nvSpPr", shape.innerStart, shape.innerEnd);
  const placeholder = nonVisual ? parts.first("p:ph", nonVisual.innerStart, nonVisual.innerEnd) : undefined;
  return placeholder ? xmlAttr(placeholder.attrs, "type") ?? null : null;
}

/** 包一层：ZIP 异常翻译成格式错误。 */
export function readPptx(buffer: Buffer): PptxReadResult {
  try {
    return readPresentation(buffer);
  } catch (error) {
    if (error instanceof DocumentFormatError) throw error;
    if (error instanceof DocumentZipError) throw new DocumentFormatError(`无法读取 .pptx：${error.message}`);
    throw error;
  }
}

export const PPTX_SLIDE_SIZE = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
