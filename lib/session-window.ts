/**
 * How many entries one read of a session carries.
 *
 * A long session's file holds thousands of entries (an 11 MB transcript is
 * common after a day's work), and reading all of it costs seconds on a phone:
 * the transfer, the parse and the first render all grow with the file. The
 * chat opens on this many newest entries and pages upward as the reader
 * scrolls back, so the first paint is bounded by a window, not by the file.
 */
export const SESSION_WINDOW_ENTRIES = 300;
