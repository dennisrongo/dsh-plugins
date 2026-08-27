import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";

/**
 * dsh-headless-plus startup: the Claude Code-style headless app's command-line
 * provider. Parses the task positional plus --model, --resume, --continue and
 * --session-info, then publishes HEADLESS_PLUS_STARTUP_SERVICE. Modeled on the
 * stock headless-startup; the launcher hands everything after its own flags to
 * this program verbatim, so app-owned flags are first-class.
 *
 * @module dsh-headless-plus/startup
 */

/** Stable Cordis plugin name. */
export const name = "headless-plus-startup";

/** Services required before the task can be resolved. */
export const inject = ["cmdlineArgs"];

/** Service provided by this plugin and injected by the runner. */
export const HEADLESS_PLUS_STARTUP_SERVICE = "headlessPlusStartup";

/**
 * Parse a "provider/model" override string. Returns null when absent, throws a
 * plain Error with a usage hint when malformed (no slash, empty parts).
 * @param {string} value
 * @returns {{provider: string, model: string} | null}
 */
export function parseModelOverride(value) {
  if (value === undefined) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash >= value.length - 1) {
    throw new Error(
      `--model expects provider/model, for example --model zai-glm/glm-5.3 or --model anthropic/claude-sonnet-4-6 (got "${value}")`,
    );
  }
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

/**
 * Build the command program. Fresh per call so one process can parse more
 * than once (tests).
 * @returns {import("commander").Command}
 */
export function headlessPlusCommand() {
  return (
    new Command()
      .name("dsh --profile headless-plus")
      .description("Answer one task on a new or resumed session, print the final assistant message, and exit.")
      .helpOption("-h, --help", "show this help")
      .argument("[task...]", "the task text; multiple words are joined by spaces")
      .option("--model <provider/model>", "use this model for the run, e.g. zai-glm/glm-5.3")
      .option("--resume <session-id|latest>", "resume a persisted session instead of creating one")
      .option("-c, --continue", "alias for --resume latest (like claude -c)")
      .option("--session-info", "print the session id to stderr when the run completes")
      .addHelpText(
        "after",
        `
Examples:
  dsh --profile headless "run the tests"                                  stock one-shot
  dsh --profile headless --model anthropic/claude-sonnet-4-6 "task"       per-run model
  dsh --profile headless --continue "now add tests"                       follow-up turn
  dsh --profile headless --resume latest "keep going"                     same thing, explicit
  dsh --profile headless --resume session-<uuid> "back to that one"       specific session
`,
      )
  );
}

/**
 * Parse and provide the resolved startup values as an ordinary Cordis service.
 * On rejection (and on --help) nothing is provided, so dependent rows never
 * activate — same contract as the stock startup.
 * @param {import("@deepseek-ai/cordis").Context} ctx - plugin context carrying the command line.
 */
export function apply(ctx) {
  const program = headlessPlusCommand();
  program.action(() => {
    const task = program.args.join(" ");
    if (task.trim() === "") {
      program.error(
        `error: a task is required, for example: dsh --profile headless "run the tests"`,
      );
    }
    const resumeFlag = program.opts().resume;
    const continueFlag = program.opts().continue;
    if (resumeFlag !== undefined && continueFlag) {
      program.error("error: --resume and --continue are mutually exclusive");
    }
    let resume;
    if (resumeFlag !== undefined) resume = resumeFlag;
    else if (continueFlag) resume = "latest";
    const model = parseModelOverride(program.opts().model);
    ctx.provide(HEADLESS_PLUS_STARTUP_SERVICE, {
      task,
      model,
      resume,
      sessionInfo: program.opts().sessionInfo === true,
    });
  });
  parseCmdline(ctx, program);
}
