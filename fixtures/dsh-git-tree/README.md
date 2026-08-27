# dsh-git-tree

Seed content for the scratch workspace that exercises the `@dennisrongo/dsh-git`
Changes tab.

This directory is **not** a git repository — it is plain files tracked by the
dsh-plugins monorepo. `plugins/dsh-git/test/verify-commit.mjs` provisions a real
scratch repository at `%TEMP%\dsh-git-tree` (override with `DSH_REPO`), seeding it
from this folder and leaving one uncommitted file so the tab always has a row to
stage.

That scratch path is stable rather than per-run because dsh-git operates on the
workspace of the session the test clicks: add the path as a workspace in dsh once,
and anything the test commits shows up in the tab's history view.
