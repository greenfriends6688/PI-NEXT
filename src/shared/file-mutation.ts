/**
 * One change to the file tree.
 *
 * Shared because the renderer builds it and the engine authorises it, and the two must agree
 * on the vocabulary — a typo in a `kind` would otherwise be a silent no-op rather than an
 * error. See `engine/workspace-mutate.ts` for the guard: the paths here are a request, not an
 * authorisation.
 */
export type FileMutation =
  | { kind: "mkdir"; path: string }
  | { kind: "touch"; path: string }
  | { kind: "rename"; path: string; to: string }
  | { kind: "delete"; path: string };
