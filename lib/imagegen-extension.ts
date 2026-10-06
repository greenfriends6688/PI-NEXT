import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

import {
  IMAGEGEN_MAX_BATCH,
  ensureGeneratedImagesRootRegistered,
  generateImagesWithProfile,
  profileIsConfigured,
  readImageGenConfig,
  resolveDestWithinCwd,
  saveGeneratedImageSync,
  type GeneratedImageFile,
} from "./imagegen-config";

/**
 * fork:imagegen —— `generate_image` 工具：对话里直接出图。
 *
 * **为什么是工具而不是 skill**：生图是花钱 + 写盘的副作用（`AGENTS.md` 的
 * `fork:proma-00-skill-policy`）。工具名在 `get_tools` 里、能被 `tool_call` 审批按名字拦
 * （ask/plan 模式下进「未分类 → 需审批」档）、能在设置 → 生图模型里配置。
 *
 * **结果永不含 base64**（MusePi 同一条铁律）：content 只给「路径 + 尺寸 + 字节」一行文本
 * —— 路径是模型与标书正文引用它的凭据；图片本体落在磁盘上，会话文件里只存这一行。
 * 预览由消息流的结果卡（`details.images` → `/api/files`）负责，不靠模型自觉。
 *
 * 落盘两个去处：默认 `~/.pi/agent/generated-images/YYYYMMDD/`（对话随手画，不污染项目）；
 * `dest` 给了就写进会话 cwd 内（标书配图 `bid/<项目>/images/` 直落）。越出 cwd 的
 * dest 一律拒绝——`/api/files` 的授权边界不因生图放宽。
 */

export const HOST_IMAGEGEN_EXTENSION_NAME = "pi-web-imagegen";

/** 多张时在途上限来自档案（1-4）；这里只是 worker 池的实现上限。 */
function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  return Promise.all(runners).then(() => results);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function createImageGenExtension(sessionCwd?: string): InlineExtension {
  return {
    name: HOST_IMAGEGEN_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      // 进程内第一次生图 / 测试时把默认落盘根登记进 /api/files 允许清单（幂等）。
      // 这里在工厂创建时注册一次即可——allowed roots 是进程级 Set。
      ensureGeneratedImagesRootRegistered();

      pi.registerTool(defineTool({
        name: "generate_image",
        label: "Generate image",
        description: [
          "Generate images from a text prompt with the image-generation model the user configured in Settings → Image models.",
          "Returns saved file paths; the user sees a preview card in the conversation automatically.",
          "Use it when the user asks to draw / generate / paint an image, or when a document needs an illustration.",
        ].join(" "),
        promptSnippet: "Generate images from a prompt with the configured image model",
        promptGuidelines: [
          "Write the prompt in concrete visual terms (subject, composition, lighting, style); the provider only sees this prompt.",
          "Reference a generated image in your reply as ![image](<path>) so the path survives into exports; never invent a path that was not returned here.",
          "A failed call usually means the profile is unconfigured or out of quota — report the error verbatim instead of describing the image in words.",
        ],
        parameters: Type.Object({
          prompt: Type.String({ description: "What to draw. Concrete and visual: subject, composition, lighting, style." }),
          n: Type.Optional(Type.Number({ description: `How many images, 1-${IMAGEGEN_MAX_BATCH}. Default 1.` })),
          size: Type.Optional(Type.String({ description: "Image size like 1024x1024. Omit to use the profile default." })),
          dest: Type.Optional(Type.String({ description: "Optional directory inside the project cwd to save into (e.g. bid/<project>/images). Omit for the shared generated-images folder." })),
        }),
        async execute(_toolCallId, params, signal) {
          const config = readImageGenConfig();
          const profile = config.providers[config.active];
          if (!profileIsConfigured(profile)) {
            return {
              content: [{
                type: "text" as const,
                text: "No image-generation model is configured. The user adds one in Settings → Image models (provider, base URL, API key, model), then runs the connection test there.",
              }],
              details: undefined,
              isError: true,
            };
          }

          const n = Math.min(IMAGEGEN_MAX_BATCH, Math.max(1, Math.floor(params.n ?? 1)));
          const destDir = params.dest?.trim();
          let saveRoot: string;
          if (destDir) {
            if (!sessionCwd) {
              return {
                content: [{ type: "text" as const, text: "dest was given but this session has no project cwd; omit dest to save into the shared generated-images folder." }],
                details: undefined,
                isError: true,
              };
            }
            const resolved = resolveDestWithinCwd(sessionCwd, destDir);
            if (!resolved) {
              return {
                content: [{ type: "text" as const, text: `dest must stay inside the session cwd (${sessionCwd}); got ${destDir}.` }],
                details: undefined,
                isError: true,
              };
            }
            saveRoot = resolved;
          } else {
            saveRoot = ensureGeneratedImagesRootRegistered();
          }

          const outcomes = await runPool(
            Array.from({ length: n }, (_, index) => index),
            profile.concurrency,
            (index) => generateImagesWithProfile(
              profile,
              { prompt: params.prompt, n: 1, ...(params.size ? { size: params.size } : {}) },
              {
                ...(signal ? { signal } : {}),
                saveImage: (data, mimeType) => saveGeneratedImageSync(saveRoot, data, mimeType),
              },
            ).then((outcome) => ({ index, outcome })),
          );

          const saved: GeneratedImageFile[] = [];
          const failures: string[] = [];
          for (const { outcome } of outcomes) {
            if (outcome.ok) saved.push(...outcome.images);
            else failures.push(outcome.error ?? "unknown error");
          }

          if (saved.length === 0) {
            return {
              content: [{
                type: "text" as const,
                text: `Image generation failed: ${failures.join(" | ")}`,
              }],
              details: undefined,
              isError: true,
            };
          }

          const lines = saved.map((image, index) =>
            `${index + 1}. ${image.path} (${image.mimeType}, ${formatBytes(image.bytes)})`);
          const partial = failures.length > 0 ? `\n${failures.length} of ${outcomes.length} request(s) failed: ${failures.join(" | ")}` : "";
          return {
            content: [{
              type: "text" as const,
              text: `Generated ${saved.length} image(s):\n${lines.join("\n")}${partial}`,
            }],
            details: { images: saved.map((image) => ({ path: image.path, mimeType: image.mimeType, bytes: image.bytes })) },
            ...(failures.length >= outcomes.length ? { isError: true } : {}),
          };
        },
      }));
    },
  };
}
