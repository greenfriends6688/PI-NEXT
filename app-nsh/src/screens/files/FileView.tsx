// The file viewer: one file, shown as what it is.
//
// The decision of *what* to show is the server's: `?type=meta` answers
// `previewKind` / `mime` / `language` (`app/api/files/[...path]/route.ts`, the
// `meta` branch), and only the two formats it reports as plain text are told
// apart by extension (`markdown`, and `.csv`/`.tsv` for `lib/delimited-table.ts`).
// `previewKind` is `documentPreviewKind()`'s pair (`lib/file-types.ts:69-73`),
// and the language names are the route's `EXT_TO_LANGUAGE` table
// (`route.ts:53-72`): they are NSH `Editor` language names or aliases already
// ("typescript", "tsx", "bash", "markdown", "text", "dockerfile", ...;
// `nsh-base/src/editor/language.rs:859-916` resolves name, alias, extension and
// file path, so no second mapping is kept here).
//
// NSH pieces this follows, one per kind:
//   Editor      nsh-main/crates/nsh-base/src/editor/mod.rs:74-114 (`readOnly`,
//               `language`, `value`) — the built-in highlighting; never Prism
//   TextView    nsh-main/docs/dev/text-view.md:1-20 — Markdown reads as a document
//   DataTable   nsh-main/docs/dev/data-table.md:1-20 + `DataTableProps`
//               (base.d.ts `columns`/`data`: array rows are indexed by column);
//               widths are pi-next's `measureColumnWidths` (the table
//               virtualizes itself, so `visibleRowRange` is not needed)
//   Image       nsh-main/docs/dev/images.md:1-30 (`src` is a URL; `objectFit`)
//   WebView     nsh-main/docs/dev/web.md "Web views" — `<iframe>` / WKWebView;
//               `WebView.available()` says whether it shows a page
//   Video       nsh-main/docs/dev/js-modules.md:39 (`<video>`s, `controls`)
//   AudioPlayer nsh-main/docs/dev/audio-design.md:189-217 (`load` / `progress`
//               events, `seek`, `state`)
//
// The look is the gallery's (`ui/kit`): the panel is a section surface, its head
// the kit's `ToggleButton` and `Inset`s of `Caption`s, the table the shared
// `dataTableClasses`, the Markdown's links `textViewLinkClasses`. Numbers are
// pi-next's `.code-head` / `.file-viewer-path` / `.file-source-view`
// (`app/v5/panel.css:180-440`): a 36-point head (0 8 0 12, gap 6), the path at
// 11.5 points, the counts at 10.5, code at 11.5 over 19-point rows (its 1.65
// line-height), a Markdown document at 12.5 with 18 / 20 padding, the "Load
// more" footer under a hairline.
//
// Text arrives in 256 KB chunks (`?type=read&offset=`), and "Load more" reads
// one more. `?type=watch` keeps the file live: its `change` frame re-reads the
// metadata and makes the body's source new, which is the reload.
//
// Bytes are shown by URL, not through `req()`: `?type=read` streams an image,
// audio or video with its `Content-Type` (`route.ts:503-541`), a PDF with
// `application/pdf`, and `?type=preview` answers a docx as a finished HTML page
// (`route.ts:565-592`; only docx: a PDF is `?type=read` in an iframe, as
// pi-next's `DocumentViewer` does, `components/FileViewer.tsx:974-983`).

import { AudioPlayer, computed, effect, Image, resource, Scroll, signal, Text, Video, View, WebView } from "nsh";
import type { AudioPlayerState, AudioProgress } from "nsh";
import { DataTable, Editor, Slider, TextView } from "nsh/base";
import type { DataTableColumn } from "nsh/base";
import { ApiError } from "../../api/client";
import { fileApiUrl, readFileMeta, readText, watchFile, type FileMeta, type FileText } from "../../api/files";
import { delimiterForPath, measureColumnWidths, parseDelimitedTable } from "../../lib/delimited-table";
import { DOCX_PREVIEW_MAX_BYTES, IMAGE_PREVIEW_MAX_BYTES } from "../../lib/file-types";
import { displayPathWithin, shortenPath } from "../../lib/display-path";
import { activeCwd, selectedSessionId } from "../../state/session";
import { mono, sans } from "../../ui/fonts";
import { t } from "../../ui/i18n";
import {
  Button,
  Caption,
  colors,
  dataTableClasses,
  Inset,
  sectionSurface,
  sliderFill,
  sliderLook,
  textViewLinkClasses,
  ToggleButton,
} from "../../ui/kit";
import { errorText } from "./state";
import { activeFileTab } from "./tabs";

/** How a file is shown, out of what `?type=meta` reported. */
type ViewerKind = "image" | "pdf" | "docx" | "audio" | "video" | "markdown" | "table" | "source";

function viewerKind(filePath: string, meta: FileMeta): ViewerKind {
  // The two documents the route names (`documentPreviewKind`, lib/file-types.ts):
  // pdf streams its bytes, docx has an HTML preview.
  if (meta.previewKind === "pdf") return "pdf";
  if (meta.previewKind === "docx") return "docx";
  if (meta.mime.startsWith("image/")) return "image";
  if (meta.mime.startsWith("audio/")) return "audio";
  if (meta.mime.startsWith("video/")) return "video";
  if (meta.language === "markdown") return "markdown";
  if (delimiterForPath(filePath)) return "table";
  return "source";
}

/** The kinds the viewer reads as text (`?type=read` as JSON, not bytes). */
function readsText(kind: ViewerKind | null): boolean {
  return kind === "source" || kind === "markdown" || kind === "table";
}

/** Bytes as B / KB / MB, for a size line. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Seconds as `m:ss` (pi-next's `formatDuration`), `--:--` while unknown. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * A thrown read as a line that says what to do. The route answers `{ error }`
 * with a status (`route.ts:483-505, 574`: 403 outside the browsable roots, 404 a
 * path that is gone, 400 a directory, 413 a preview over its limit), and a
 * `cwd-missing` body names the session's folder that moved (`lib/missing-cwd.ts`;
 * `ApiError.missingCwd`, `api/client.ts:93-97`).
 */
function fileErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.missingCwd) return t("errors.missingCwd", { cwd: error.missingCwd });
    if (error.status === 404) return t("errors.notFound");
    if (error.status === 403) return t("errors.forbidden");
    if (error.status === 413) return t("errors.tooLarge");
    if (error.status === 400) return t("files.notAFile");
  }
  return errorText(error);
}

/** A line of the viewer at 11.5 points (pi-next's `.file-viewer-path`). */
const pathText = () => ({ fontSize: 11.5, color: colors.muted });
/** A count at 10.5 points in tabular figures (pi-next's `.file-viewer-line-count`). */
const countText = () => ({ fontSize: 10.5, color: colors.faint, fontVariant: ["tabular-nums"] as ["tabular-nums"] });

/**
 * The viewer of the active file tab, or of `path` when the shell has one to
 * give (an accessor: the value changes, the component body does not run again).
 * The shell mounts this as the content of a file tab, never under the tree.
 */
export function FileView(props: { path?: () => string | null } = {}) {
  const target = computed(() => (props.path ? props.path() : activeFileTab()));
  return (
    <View style={{ ...sectionSurface(), flex: 1, minHeight: 0, overflow: "hidden" }}>
      <If when={target()} else={<NoFile />}>
        {(path) => <FileBody path={path} />}
      </If>
    </View>
  );
}

/** Nothing open: which one to open, or that there is no folder to browse. */
function NoFile() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 4, padding: 24 }}>
      <If
        when={activeCwd()}
        else={
          <View style={{ alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>{t("common.noWorkingDirectory")}</Text>
            <Text style={{ fontSize: 11.5, color: colors.faint }}>{t("files.noWorkingDirectoryHint")}</Text>
          </View>
        }
      >
        <Text style={{ fontSize: 13, color: colors.muted }}>{t("files.noneOpen")}</Text>
        <Text style={{ fontSize: 11.5, color: colors.faint }}>{t("files.chooseFileInTree")}</Text>
      </If>
    </View>
  );
}

/** One file: its metadata, then its body in the shape the metadata names. */
function FileBody(props: { path: () => string }) {
  // The read keeps the path it was asked for: a resource keeps its previous
  // value while the next load runs (`resource`, `nsh/index.d.ts:682-687`), and
  // a viewer must never draw the file it was showing a moment ago under the new
  // file's name.
  const metaRead = resource(
    () => props.path(),
    async (path, info) => ({
      path,
      meta: await readFileMeta(path, { signal: info.signal, sessionId: selectedSessionId() }),
    }),
  );
  const meta = computed<FileMeta | null>(() => {
    const value = metaRead();
    return value && value.path === props.path() ? value.meta : null;
  });

  /** Bumped by a watch frame: every URL and the body's source follow it. */
  const revision = signal(0);

  /** How many 256 KB chunks the text body reads ("Load more" asks for one more). */
  const read = signal<{ path: string; pages: number }>({ path: "", pages: 1 });
  const pages = computed(() => (read().path === props.path() ? read().pages : 1));
  const loadMore = () => read.set({ path: props.path(), pages: pages() + 1 });

  /** Long lines wrap at the pane's width (the head's switch), as pi-next's wrap button. */
  const wrapped = signal(false);

  const kind = computed<ViewerKind | null>(() => {
    const current = meta();
    return current ? viewerKind(props.path(), current) : null;
  });
  const isText = computed(() => readsText(kind()));
  const wraps = computed(() => kind() === "source" || kind() === "markdown");

  // The text read, and only for the kinds that are text: `?type=read` answers
  // bytes for an image. `null` is a source that loads nothing (`resource`).
  const textRead = resource(
    computed(() => {
      const current = kind();
      return readsText(current) ? { path: props.path(), pages: pages(), revision: revision() } : null;
    }),
    async (asked, info) => ({
      path: asked.path,
      page: await readText(asked.path, {
        pages: asked.pages,
        signal: info.signal,
        sessionId: selectedSessionId(),
      }),
    }),
  );
  const text = computed<FileText | null>(() => {
    const value = textRead();
    return value && value.path === props.path() ? value.page : null;
  });

  const title = computed(() => {
    const path = props.path();
    const root = activeCwd();
    return root ? displayPathWithin(path, root) : shortenPath(path);
  });

  /** The lines a text body shows, for the head's count (pi-next's line count). */
  const lineCount = computed(() => {
    const page = text();
    return page && !page.binary ? page.content.split("\n").length : 0;
  });

  // Every byte URL: an image, an audio or video stream, a PDF's bytes, a docx's
  // HTML page. `v` re-requests it after a write, as pi-next's `bust` does.
  const imageUrl = computed(() => fileApiUrl(props.path(), "read", { v: revision() }));
  const mediaUrl = computed(() => {
    const current = kind();
    return current === "audio" || current === "video"
      ? fileApiUrl(props.path(), "read", { v: revision() })
      : "";
  });
  const documentUrl = computed(() => {
    const current = kind();
    if (current === "pdf") return fileApiUrl(props.path(), "read", { v: revision() });
    if (current === "docx") return fileApiUrl(props.path(), "preview", { v: revision() });
    return "";
  });

  // What the media element or the web view reported, tagged with the URL it
  // belongs to: a new URL never shows the old file's size, duration or failure.
  const imageInfo = signal<{ url: string; width: number; height: number } | null>(null);
  const imageError = signal<{ url: string; message: string } | null>(null);
  const mediaInfo = signal<{ url: string; duration: number } | null>(null);
  const mediaError = signal<{ url: string; message: string } | null>(null);
  const webViewError = signal<{ url: string; message: string } | null>(null);

  const naturalSize = computed(() => {
    const info = imageInfo();
    return info && info.url === imageUrl() ? info : null;
  });
  const imageFailure = computed(() => {
    const failure = imageError();
    return failure && failure.url === imageUrl() ? failure.message : null;
  });
  const duration = computed(() => {
    const info = mediaInfo();
    return info && info.url === mediaUrl() ? info.duration : 0;
  });
  const mediaFailure = computed(() => {
    const failure = mediaError();
    return failure && failure.url === mediaUrl() ? failure.message : null;
  });
  const documentFailure = computed(() => {
    const failure = webViewError();
    return failure && failure.url === documentUrl() ? failure.message : null;
  });
  const durationLabel = computed(() => (duration() > 0 ? formatDuration(duration()) : null));
  const naturalLabel = computed(() => {
    const info = naturalSize();
    return info ? `${info.width} × ${info.height}` : null;
  });

  // The two size limits the route enforces (413): an image over 10 MB and a
  // docx over 10 MB (`lib/file-types.ts:1-3`), checked here so the panel says
  // why rather than showing a failed load.
  const imageTooLarge = computed(() => kind() === "image" && (meta()?.size ?? 0) > IMAGE_PREVIEW_MAX_BYTES);
  const docxTooLarge = computed(() => kind() === "docx" && (meta()?.size ?? 0) > DOCX_PREVIEW_MAX_BYTES);

  // Whether this platform shows a web view (`docs/dev/web.md` "Web views"):
  // resolved once, `null` until it answers.
  const webViewAvailable = signal<boolean | null>(null);
  void WebView.available().then(
    (available) => webViewAvailable.set(available),
    () => webViewAvailable.set(false),
  );

  // An audio file streams through an `AudioPlayer` (`audio-design.md:189-217`):
  // made for each URL, disposed with the next one or with the view, its
  // `load` / `progress` / `error` events the head's duration and the scrubber.
  const player = signal<AudioPlayer | null>(null);
  const playerState = signal<AudioPlayerState>("idle");
  const playerTime = signal<{ url: string; currentTime: number } | null>(null);
  const audioError = signal<{ url: string; message: string } | null>(null);

  const played = computed(() => {
    const time = playerTime();
    return time && time.url === mediaUrl() ? time.currentTime : 0;
  });
  const audioFailure = computed(() => {
    const failure = audioError();
    return failure && failure.url === mediaUrl() ? failure.message : null;
  });

  effect(() => {
    if (kind() !== "audio") return;
    const url = mediaUrl();
    let audio: AudioPlayer;
    try {
      audio = new AudioPlayer(url);
    } catch (error) {
      audioError.set({ url, message: fileErrorText(error) });
      return;
    }
    player.set(audio);
    playerState.set("loading");
    playerTime.set({ url, currentTime: 0 });
    audioError.set(null);
    const stopLoad = audio.on("load", (load) => mediaInfo.set({ url, duration: load.duration }));
    const stopProgress = audio.on("progress", (progress: AudioProgress) => {
      playerTime.set({ url, currentTime: progress.currentTime });
      mediaInfo.set({ url, duration: progress.duration });
      playerState.set(audio.state);
    });
    const stopEnd = audio.on("end", () => playerState.set("ended"));
    const stopError = audio.on("error", (error) => {
      audioError.set({ url, message: t("files.audioPlayFailed", { code: error.code }) });
      playerState.set("idle");
    });
    audio.preload();
    return () => {
      stopLoad();
      stopProgress();
      stopEnd();
      stopError();
      audio.dispose();
      player.set(null);
    };
  });

  const toggleAudio = () => {
    const audio = player();
    if (!audio) return;
    if (audio.state === "playing" || audio.state === "loading") {
      audio.pause();
      playerState.set(audio.state);
      return;
    }
    playerState.set("loading");
    void audio.play().then(
      () => playerState.set(audio.state),
      (error: unknown) => {
        audioError.set({ url: mediaUrl(), message: fileErrorText(error) });
        playerState.set(audio.state);
      },
    );
  };

  const seekAudio = (seconds: number) => {
    const audio = player();
    if (!audio) return;
    try {
      audio.seek(seconds);
      playerTime.set({ url: mediaUrl(), currentTime: seconds });
    } catch {
      // A seek past a duration not known yet is the player's to refuse.
    }
  };

  // Live: the server watches the file's directory and reports a write's
  // `{ mtime, size }`. A reconnecting stream reports `connected` again, which
  // changes nothing until the file does.
  effect(() => {
    const path = props.path();
    return watchFile(path, (event) => {
      if (event.event !== "change") return;
      metaRead.refetch();
      revision.update((value) => value + 1);
    });
  });

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {/* pi-next's `.code-head`: 36 points, 0 8 0 12, gap 6. */}
      <View
        style={{
          height: 36,
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingStart: 12,
          paddingEnd: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <Text style={{ ...pathText(), flex: 1, minWidth: 0, numberOfLines: 1 }}>{title()}</Text>
        <If when={naturalLabel()}>{(label) => <Text style={countText()}>{label()}</Text>}</If>
        <If when={durationLabel()}>{(label) => <Text style={countText()}>{label()}</Text>}</If>
        <If when={lineCount()}>{(count) => <Text style={countText()}>{t("chat.extensionWidgetLines", { count: count() })}</Text>}</If>
        <If when={meta()}>{(current) => <Text style={countText()}>{formatSize(current().size)}</Text>}</If>
        <If when={wraps()}>
          <ToggleButton label={t("files.wrap")} accessibilityLabel={wrapped() ? t("i18n.disableWrap") : t("i18n.enableWrap")} on={wrapped()} onPress={() => wrapped.set(!wrapped())} />
        </If>
      </View>

      <If when={metaRead.error()}>
        {(error) => (
          <Inset padding={12}>
            <Text style={{ fontSize: 11.5, color: colors.danger }}>{fileErrorText(error())}</Text>
          </Inset>
        )}
      </If>
      <If when={!meta() && metaRead.loading()}>
        <Inset padding={12}>
          <Caption label={t("i18n.loading")} />
        </Inset>
      </If>

      {/* An image: `?type=read` streams its bytes; `v` re-requests it after a write. */}
      <If when={kind() === "image"}>
        <View
          style={{
            flex: 1,
            minHeight: 0,
            padding: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.inset,
          }}
        >
          <If
            when={!imageTooLarge()}
            else={
              <Caption
                label={t("files.imageTooLarge", {
                  size: formatSize(meta()?.size ?? 0),
                  limit: formatSize(IMAGE_PREVIEW_MAX_BYTES),
                })}
              />
            }
          >
            <Image
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              src={imageUrl()}
              accessibilityLabel={title()}
              onLoad={({ size }) => imageInfo.set({ url: imageUrl(), width: size.width, height: size.height })}
              onError={() => imageError.set({ url: imageUrl(), message: t("files.imageLoadFailed") })}
            />
          </If>
        </View>
        <If when={imageFailure()}>
          {(message) => (
            <Inset padding={12}>
              <Text style={{ fontSize: 11.5, color: colors.danger }}>{message()}</Text>
            </Inset>
          )}
        </If>
      </If>

      {/* A PDF or a Word document: the web view shows the URL as a page.
          TODO(nsh): an Android WebView has no PDF viewer (its page stays blank)
          while `WebView.available()` is true there, so the fallback note only
          covers a platform without web views at all.
          TODO(nsh): pi-next also renders an HTML file as a page (`language ===
          "html"`, `components/FileViewer.tsx:1439-1460`); here an HTML file
          stays the source `Editor`. */}
      <If when={kind() === "pdf" || kind() === "docx"}>
        <If when={docxTooLarge()}>
          <Inset padding={12}>
            <Caption
              label={t("files.documentTooLarge", {
                kind: kind() === "pdf" ? "PDF" : "Word",
                size: formatSize(meta()?.size ?? 0),
                limit: formatSize(DOCX_PREVIEW_MAX_BYTES),
              })}
            />
          </Inset>
        </If>
        <If when={!docxTooLarge() && webViewAvailable() === false}>
          <Inset padding={12}>
            <Caption
              label={t("files.documentNotPreviewed", {
                kind: kind() === "pdf" ? "PDF" : "Word",
                size: formatSize(meta()?.size ?? 0),
              })}
            />
          </Inset>
        </If>
        <If when={!docxTooLarge() && webViewAvailable() === true}>
          <WebView
            style={{ flex: 1, minHeight: 0 }}
            src={documentUrl()}
            accessibilityLabel={title()}
            onError={() => webViewError.set({ url: documentUrl(), message: t("files.documentPreviewFailed") })}
          />
        </If>
        <If when={!docxTooLarge() && webViewAvailable() === null}>
          <Inset padding={12}>
            <Caption label={t("i18n.loading")} />
          </Inset>
        </If>
        <If when={documentFailure()}>
          {(message) => (
            <Inset padding={12}>
              <Text style={{ fontSize: 11.5, color: colors.danger }}>{message()}</Text>
            </Inset>
          )}
        </If>
      </If>

      {/* A video: the platform's own player (`<video>` / AVPlayer / MediaPlayer). */}
      <If when={kind() === "video"}>
        <View style={{ flex: 1, minHeight: 0, padding: 16, backgroundColor: colors.inset }}>
          <Video
            style={{ flex: 1, minHeight: 0, width: "100%" }}
            src={mediaUrl()}
            controls
            onLoad={({ duration: loaded }) => mediaInfo.set({ url: mediaUrl(), duration: loaded })}
            onError={() => mediaError.set({ url: mediaUrl(), message: t("files.videoLoadFailed") })}
          />
        </View>
        <If when={mediaFailure()}>
          {(message) => (
            <Inset padding={12}>
              <Text style={{ fontSize: 11.5, color: colors.danger }}>{message()}</Text>
            </Inset>
          )}
        </If>
      </If>

      {/* Audio: a play button, a scrubber and the times (`AudioPlayer`). */}
      <If when={kind() === "audio"}>
        <View
          style={{
            flex: 1,
            minHeight: 0,
            padding: 24,
            justifyContent: "center",
            backgroundColor: colors.inset,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Button
              label={playerState() === "playing" ? t("files.pause") : t("files.play")}
              icon={playerState() === "playing" ? "pause" : "play"}
              accessibilityLabel={playerState() === "playing" ? t("files.pauseAudio") : t("files.playAudio")}
              disabled={!player()}
              onPress={toggleAudio}
            />
            <Slider
              style={{ flex: 1 }}
              value={played()}
              min={0}
              max={duration() > 0 ? duration() : 1}
              step={0.1}
              disabled={duration() <= 0}
              accessibilityLabel={t("files.audioPosition")}
              onChange={({ value }) => seekAudio(Array.isArray(value) ? value[0] : value)}
              rangeStyle={sliderFill(0, duration() > 0 ? played() / duration() : 0)}
              {...sliderLook()}
            />
            <Text style={{ ...countText(), fontSize: 11 }}>
              {`${formatDuration(played())} / ${durationLabel() ?? "--:--"}`}
            </Text>
          </View>
          <If when={audioFailure()}>
            {(message) => <Text style={{ fontSize: 11.5, color: colors.danger, paddingTop: 12 }}>{message()}</Text>}
          </If>
        </View>
      </If>

      <If when={isText()}>
        <FileTextBody
          path={props.path}
          kind={kind}
          mime={() => meta()?.mime ?? "application/octet-stream"}
          text={text}
          textError={textRead.error}
          textLoading={textRead.loading}
          pages={pages}
          wrapped={wrapped}
          onLoadMore={loadMore}
        />
      </If>
    </View>
  );
}

/**
 * The text kinds: source in a read-only `Editor`, Markdown in a `TextView`, a
 * CSV/TSV table in a `DataTable`. All three share the read, its error and the
 * "Load more" footer.
 */
function FileTextBody(props: {
  path: () => string;
  kind: () => ViewerKind | null;
  /** The `?type=meta` mime, for the line a binary file shows instead of a body. */
  mime: () => string;
  /** The chunk read, `null` until it arrives (or while another file is asked for). */
  text: () => FileText | null;
  textError: () => unknown;
  textLoading: () => boolean;
  /** Chunks read so far, for the "shown" line. */
  pages: () => number;
  /** Whether long lines wrap (the head's switch). */
  wrapped: () => boolean;
  onLoadMore: () => void;
}) {
  const table = computed(() => {
    const page = props.text();
    if (!page || page.binary || props.kind() !== "table") return null;
    // `complete: false` while the file is cut: the last, partial record is left
    // out rather than shown chopped (`lib/delimited-table.ts` `parseDelimitedRecords`).
    return parseDelimitedTable(page.content, props.path(), !page.truncated);
  });
  // Each column as wide as its widest sampled value (`measureColumnWidths`,
  // pi-next's `components/DelimitedTable.tsx:74-75`), clamped 64–420.
  const widths = computed(() => {
    const data = table();
    return data ? measureColumnWidths(data.columns, data.rows) : [];
  });
  // Array rows are indexed by the columns' place, so a key is only an identity.
  const columns = computed<DataTableColumn[]>(() => {
    const data = table();
    if (!data) return [];
    const measured = widths();
    return data.columns.map((title, index) => ({
      key: String(index),
      title,
      width: measured[index] ?? 160,
      minWidth: 60,
    }));
  });
  const rows = computed(() => table()?.rows ?? []);

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <If when={props.textError()}>
        {(error) => (
          <Inset padding={12}>
            <Text style={{ fontSize: 11.5, color: colors.danger }}>{fileErrorText(error())}</Text>
          </Inset>
        )}
      </If>
      <If when={!props.text() && props.textLoading()}>
        <Inset padding={12}>
          <Caption label={t("i18n.loading")} />
        </Inset>
      </If>

      <If when={props.text()}>
        {(page) => (
          <View style={{ flex: 1, minHeight: 0 }}>
            <If when={page().binary}>
              <Inset padding={12}>
                <Caption
                  label={t("files.binaryPreview", { mime: props.mime(), size: formatSize(page().size) })}
                />
              </Inset>
            </If>

            <If when={!page().binary && props.kind() === "source"}>
              <Editor
                style={{ flex: 1, minHeight: 0 }}
                readOnly
                value={page().content}
                language={page().language}
                softWrap={props.wrapped()}
                // pi-next's `.file-source-view`: 11.5 over 19-point rows (1.65).
                fontSize={11.5}
                lineHeight={19}
                // The editor's font is the theme's `font-mono` by default (one
                // family, else the system's `monospace`): name the app's
                // monospaced list, whose Chinese glyphs come from PingFang SC /
                // YaHei / Noto Sans CJK SC. The editor measures its text in
                // this font, so it is a prop, not a style.
                fontFamily={mono}
              />
            </If>

            <If when={!page().binary && props.kind() === "markdown"}>
              <Scroll style={{ flex: 1, minHeight: 0 }}>
                <TextView
                  markdown={page().content}
                  selectable
                  classes={textViewLinkClasses}
                  // pi-next's `.markdown-file-preview`: 18 / 20 around a 12.5-point document.
                  styles={{
                    root: { paddingVertical: 18, paddingHorizontal: 20, fontSize: 12.5, lineHeight: 20.6, fontFamily: sans },
                    code: { fontFamily: mono },
                    codeBlockCode: { fontFamily: mono },
                  }}
                />
              </Scroll>
            </If>

            <If when={!page().binary && props.kind() === "table"}>
              <DataTable
                style={{ flex: 1, minHeight: 0 }}
                // A table's cells take its font; its Chinese comes from the
                // same list (a cell is a text like any other).
                fontFamily={sans}
                columns={columns()}
                data={rows()}
                rowHeader={false}
                stripe
                classes={dataTableClasses}
              />
            </If>

            <If when={page().truncated}>
              <View
                style={{
                  flexShrink: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderTopWidth: 1,
                  borderTopColor: colors.line,
                }}
              >
                <Text style={{ flex: 1, minWidth: 0, fontSize: 11, color: colors.faint, numberOfLines: 1 }}>
                  {props.pages() === 1
                    ? t("files.showingFirstChunk", { shown: formatSize(page().nextOffset), size: formatSize(page().size) })
                    : t("files.showingFirstChunks", {
                        shown: formatSize(page().nextOffset),
                        size: formatSize(page().size),
                        count: props.pages(),
                      })}
                </Text>
                <Button label={t("i18n.loadMore")} variant="secondary" size="small" onPress={props.onLoadMore} />
              </View>
            </If>
          </View>
        )}
      </If>
    </View>
  );
}
