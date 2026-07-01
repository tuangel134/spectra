/**
 * Keyboard input parsing.
 *
 * Translates raw bytes from a terminal in raw mode into structured key events.
 * Pure and testable: `parseKey` takes a string chunk and returns a Key.
 */

export interface Key {
  name:
    | "char"
    | "enter"
    | "backspace"
    | "tab"
    | "escape"
    | "up"
    | "down"
    | "left"
    | "right"
    | "ctrl-c"
    | "ctrl-d"
    | "ctrl-p"
    | "ctrl-u"
    | "delete"
    | "paste"
    | "unknown"
  /** The literal character for name === "char", or the pasted text for "paste". */
  sequence: string
}

/** Parse a raw input chunk into a Key event. */
export function parseKey(chunk: string): Key {
  switch (chunk) {
    case "\r":
    case "\n":
      return { name: "enter", sequence: chunk }
    case "\x7f":
    case "\b":
      return { name: "backspace", sequence: chunk }
    case "\t":
      return { name: "tab", sequence: chunk }
    case "\x03":
      return { name: "ctrl-c", sequence: chunk }
    case "\x04":
      return { name: "ctrl-d", sequence: chunk }
    case "\x10":
      return { name: "ctrl-p", sequence: chunk }
    case "\x15":
      return { name: "ctrl-u", sequence: chunk }
    case "\x1b":
      return { name: "escape", sequence: chunk }
    case "\x1b[A":
      return { name: "up", sequence: chunk }
    case "\x1b[B":
      return { name: "down", sequence: chunk }
    case "\x1b[C":
      return { name: "right", sequence: chunk }
    case "\x1b[D":
      return { name: "left", sequence: chunk }
    case "\x1b[3~":
      return { name: "delete", sequence: chunk }
    default: {
      // A single printable code point (ignore other control/escape sequences).
      // Using the spread iterator counts by code point, so an emoji or other
      // astral-plane character (a UTF-16 surrogate pair) is treated as ONE
      // printable char rather than two corrupt halves.
      if ([...chunk].length === 1 && chunk >= " " && chunk !== "\x7f") {
        return { name: "char", sequence: chunk }
      }
      return { name: "unknown", sequence: chunk }
    }
  }
}
