/**
 * Executable wrapper for the todo CLI.
 *
 * The shebang is added by the BUILD (esbuild `banner`), not written here: a
 * shebang in the source would be emitted verbatim as well, and two of them
 * makes the output a syntax error.
 *
 * Kept separate from `cli.ts` so the command logic stays importable and
 * testable without a process: this file is the only place that touches
 * `process.argv` / `process.exit`.
 *
 * @module @dennisrongo/dsh-todo/bin
 */
import { main } from './cli.ts'

process.exitCode = main(process.argv.slice(2))
