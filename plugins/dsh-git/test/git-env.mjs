/**
 * Remove git's repository-location variables from THIS process's environment.
 *
 * Every test in this package shells out to git with `execFileSync` to build
 * throwaway repositories, and those calls inherit `process.env` directly — they
 * do not go through `runGit`, so the scrub inside it does not protect them.
 *
 * Git exports GIT_DIR and friends to every hook it runs. That makes
 * `pnpm test` from a pre-commit hook actively DESTRUCTIVE rather than merely
 * wrong: `git init` resolves GIT_DIR before cwd, so a test's init lands on the
 * OUTER repository and re-initializes it — observed here setting
 * `core.bare = true` on this very repo and overwriting its user identity with a
 * test fixture's. `git config` in a fixture writes to the outer config for the
 * same reason.
 *
 * Scrubbing once at process start fixes every call site at once, which is why
 * this is a module with a side effect rather than a helper each test must
 * remember to call.
 */

/** Variables that choose which repository a git command operates on. */
export const REPO_LOCATION_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_GRAFT_FILE',
  'GIT_PREFIX',
  'GIT_INDEX_VERSION',
]

for (const name of REPO_LOCATION_ENV) delete process.env[name]
