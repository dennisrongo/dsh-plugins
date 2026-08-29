/**
 * Which face a font stack actually resolves to on THIS machine.
 *
 * System stacks name the best face per platform and fall through the rest, so
 * two presets can land on the same installed family and look identical — on a
 * stock Windows box "Humanist" reaches Segoe UI Variable Text, which is all but
 * indistinguishable from the Segoe UI the default already uses. Without this
 * the honest user reaction is "I'm not sure the font is being applied", which
 * is exactly the report that prompted it.
 *
 * `document.fonts.check()` is useless here — it answers true for any family
 * name, including nonsense, because falling back always succeeds. The reliable
 * test is the classic one: put the candidate in front of a generic and see
 * whether the measured width moves.
 */
/**
 * Split a CSS font stack into its family names, unquoted and trimmed.
 * @param stack - a `font-family` value.
 * @returns the families in declaration order.
 */
export declare function familiesOf(stack: string): string[];
/**
 * Whether a family is actually installed.
 *
 * @param family - an exact family name (not a generic).
 * @returns whether the browser can render with it.
 */
export declare function isAvailable(family: string): boolean;
/**
 * The family a stack will actually render in.
 *
 * @param stack - a `font-family` value.
 * @returns the first installed family, the generic the stack ends on if none
 * are installed, or undefined for an empty stack.
 */
export declare function resolvedFamily(stack: string): string | undefined;
