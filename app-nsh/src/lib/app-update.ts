// This app's own update check: the running build against the newest stable
// tag in PI NEXT's GitHub Releases (`greenfriends6688/PI-NEXT`).
//
// The pure helpers live here, away from `src/local/misc-routes.ts`, so a
// headless test can import them without pulling in the local server, the
// filesystem or a login shell. The route still performs the one network read
// (`curl` through `loginShellRun`); these functions only judge its answer.

/** `GET /api/app-update`; empty `releaseUrl` means GitHub could not be read. */
export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  /** Empty when no stable release could be read. */
  releaseUrl: string;
}

/** One stable release from the GitHub Releases list. */
export interface LatestAppRelease {
  /** Normalized `x.y.z`, without the tag's optional `v`. */
  version: string;
  /** The release's `html_url`, which is what the card opens. */
  releaseUrl: string;
}

/** GitHub tags stable builds as `v1.2.3`; the app's own manifest omits the `v`. */
const STABLE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * The numeric parts of a stable version, or null for a tag that is a
 * pre-release, a nightly or otherwise not a plain `v?x.y.z`.
 */
export function stableParts(version: string): [number, number, number] | null {
  const match = STABLE_VERSION.exec(version.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number) as [number, number, number];
  return parts.every((part) => Number.isSafeInteger(part)) ? parts : null;
}

function compareParts(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** True only when both sides are stable versions and `candidate` is newer. */
export function isNewerStableVersion(candidate: string, current: string): boolean {
  const next = stableParts(candidate);
  const now = stableParts(current);
  if (!next || !now) return false;
  return compareParts(next, now) > 0;
}

/**
 * The highest stable release in GitHub's `releases` JSON, or null when the
 * list is unreadable or holds no stable tag.
 *
 * GitHub's own order (and its `/releases/latest` flag) is not trusted: the
 * list is sorted newest-first, but a draft, a newer pre-release or a release
 * published later with an older tag would win. Only the semver parts decide.
 */
export function pickLatestRelease(tagsJson: string): LatestAppRelease | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tagsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  let best: LatestAppRelease | null = null;
  let bestParts: [number, number, number] | null = null;
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const tag = (entry as Record<string, unknown>).tag_name;
    const url = (entry as Record<string, unknown>).html_url;
    if (typeof tag !== "string" || typeof url !== "string" || !url.trim()) continue;
    const parts = stableParts(tag);
    if (parts === null) continue;
    if (bestParts === null || compareParts(parts, bestParts) > 0) {
      best = { version: `${parts[0]}.${parts[1]}.${parts[2]}`, releaseUrl: url.trim() };
      bestParts = parts;
    }
  }
  return best;
}
