# A daily release: plan

Record, written 2026-11-05. Carries out `docs/plans/2026-11-05-daily-release-design.md` (its sections are cited as
§N, its decisions as DN and its guard rules as RN). No task touches SQL, the engine, an instance or a deployed
service. Each is repository tooling. The Netlify cutover (§5) is the owner's and is not a task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. Task 1's check is
red on the repository as it stands, because `release.yml` does not exist yet. Tasks 2 and 3 turn it green.

## Task 1. The guard and its test (§4, D6)

Model: sonnet

Files: `tools/check-release-workflows.mjs` and `tools/test-release-workflows.mjs` (new), `tools/build.mjs` (`STEPS`),
`package.json` and `package-lock.json` (`yaml`, devDependency `^2.9.1`).

- `problems(files)` is pure and exported. `files` maps a repository path to its text: every
  `.github/workflows/*.yml` and `netlify.toml`. It returns strings that each name the file and the rule, and `[]` when
  the shape holds. The CLI reads the files from disk, prints each problem and exits 1 on any. Its header comment says
  what it guards and why (§1 and §3 in a few lines), and that it is carried from currents' check of the same name, cut
  down.
- One complaint per broken rule, R1 to R7 as §4 words them. A workflow that does not parse is a complaint naming the
  file.
- `tools/test-release-workflows.mjs` starts every case from the real files read from disk and breaks exactly one thing,
  as `tools/test-build-steps.mjs` does. The poisons, each a separate case that must produce a matching complaint:
  1. `release.yml` missing (R1).
  2. `web` dropped from the jobs (R1).
  3. `promote.needs` set to `sql`, skipping `web` (R1).
  4. `sql`'s `with.ref` set to `main` (R2).
  5. `build`'s `uses` pointed at `./.github/workflows/web.yml` (R2).
  6. `promote`'s push given `--force` (R3).
  7. `promote`'s refspec given a leading `+` (R3).
  8. `promote`'s push target changed to `refs/heads/main` (R3).
  9. `promote.permissions` given `pull-requests: write` as well (R3).
  10. `release.yml` given `push: { branches: [main] }` (R4).
  11. `workflow_dispatch` given an input `sha` (R4).
  12. `web.yml`'s `workflow_call` removed (R5).
  13. `sql.yml`'s checkout with no `ref: ${{ inputs.ref }}` (R5).
  14. `build.yml` given a step that pushes `HEAD:refs/heads/production` (R6).
  15. `build.yml` given `on.push` (R6).
  16. `netlify.toml` given `[context.production]` with `command = "npm run build"` (R7).

  The last case asserts the real files produce `[]`, so a `problems()` that has gone quiet fails rather than reading as
  green.
- In `STEPS`, `'node tools/test-release-workflows.mjs'` and then `'node tools/check-release-workflows.mjs'` go after
  `check-doc-references`, with the other fast file guards. Neither is `SERIAL`.
- Red run: `node tools/check-release-workflows.mjs` on the repository as it stands names R1 (no `release.yml`) and R5
  (three workflows without `workflow_call`). Record the output in the PR.

## Task 2. The called workflows take a ref (§3, R5)

Model: inline

Files: `.github/workflows/build.yml`, `.github/workflows/sql.yml`, `.github/workflows/web.yml`.

In each, add under `on:`:

```yaml
  # The daily release (release.yml) calls this with the candidate it is releasing.
  workflow_call:
    inputs:
      ref: { type: string, required: true }
```

Change each `- uses: actions/checkout@v4` to:

```yaml
      - uses: actions/checkout@v4
        with: { ref: '${{ inputs.ref }}' }
```

On a pull request or a dispatch `inputs.ref` is empty, and checkout uses the event's ref, as today. Add one sentence to
each header comment: "The daily release calls it on its candidate (release.yml)." Leave `if:`, `concurrency` and
`paths-ignore` alone (§3 says why they already fit). Green run: the check now names only R1.

## Task 3. The release (§3, D3 to D5)

Model: inline

File: `.github/workflows/release.yml` (new), exactly as below apart from comment wording.

```yaml
# The daily release (docs/plans/2026-11-05-daily-release-design.md). Production moves once a day, here, and nowhere
# else: the candidate is main's head when the run starts. It is built, its SQL suite and its e2e flows run, and only
# then does `production` fast-forward to it. Netlify builds `production`. A red job stops everything after it:
# production stays where it is, the run goes red and GitHub emails the owner, and `report` names the failed job.
# The fix goes forward. A dispatch, the owner's alone, always releases main's head. Migrations and functions are
# still deployed by hand (issue #243). 22:13 PDT, 21:13 PST. tools/check-release-workflows.mjs holds this shape.
# Carried from currents' release.yml, cut down to the site.
name: Release
on:
  schedule:
    - cron: '13 5 * * *'
  workflow_dispatch:
concurrency: { group: release, cancel-in-progress: false }
permissions:
  contents: read
jobs:
  candidate:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      sha: ${{ steps.pick.outputs.sha }}
      same: ${{ steps.pick.outputs.same }}
      previous: ${{ steps.pick.outputs.previous }}
    steps:
      - id: pick
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          sha=$(gh api "repos/${GITHUB_REPOSITORY}/commits/main" --jq .sha)
          prod=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/production" --jq .object.sha 2>/dev/null || true)
          # A missing ref (the first release) or an API error prints error JSON, not a SHA: only a
          # 40-character hex SHA is a previous production.
          case "$prod" in (*[!0-9a-f]*) prod="" ;; esac
          [ "${#prod}" -eq 40 ] || prod=""
          echo "sha=${sha}" >> "$GITHUB_OUTPUT"
          echo "previous=${prod}" >> "$GITHUB_OUTPUT"
          if [ "$sha" = "$prod" ]; then
            echo "same=true" >> "$GITHUB_OUTPUT"
            echo "Nothing to release: production is already at ${sha}." >> "$GITHUB_STEP_SUMMARY"
          else
            echo "same=false" >> "$GITHUB_OUTPUT"
          fi
  build:
    needs: candidate
    if: needs.candidate.outputs.same != 'true'
    uses: ./.github/workflows/build.yml
    with:
      ref: ${{ needs.candidate.outputs.sha }}
  sql:
    needs: [candidate, build]
    if: needs.candidate.outputs.same != 'true'
    uses: ./.github/workflows/sql.yml
    with:
      ref: ${{ needs.candidate.outputs.sha }}
  web:
    needs: [candidate, sql]
    if: needs.candidate.outputs.same != 'true'
    uses: ./.github/workflows/web.yml
    with:
      ref: ${{ needs.candidate.outputs.sha }}
  promote:
    needs: [candidate, web]
    if: needs.candidate.outputs.same != 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ needs.candidate.outputs.sha }}
      # A fast-forward only: no force, so `production` can only move along main.
      - run: git push origin "${{ needs.candidate.outputs.sha }}:refs/heads/production"
  report:
    needs: [candidate, build, sql, web, promote]
    if: always() && needs.candidate.result == 'success' && needs.candidate.outputs.same != 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ needs.candidate.outputs.sha }}
      - env:
          CANDIDATE: ${{ needs.candidate.outputs.sha }}
          PREVIOUS: ${{ needs.candidate.outputs.previous }}
          RESULTS: "build=${{ needs.build.result }} sql=${{ needs.sql.result }} web=${{ needs.web.result }} promote=${{ needs.promote.result }}"
        run: |
          {
            echo "## Release of ${CANDIDATE}"
            if [ -n "$PREVIOUS" ]; then echo "Previous production: ${PREVIOUS}"; else echo "First release: no previous production."; fi
            echo
            echo "Jobs: ${RESULTS}"
            failed=$(echo "$RESULTS" | tr ' ' '\n' | grep -E '=(failure|cancelled)$' | cut -d= -f1 | tr '\n' ' ')
            if [ -n "$failed" ]; then echo; echo "**Held.** Production did not move. Failed: ${failed}"; fi
            echo
            echo "### Commits in this release"
            if [ -n "$PREVIOUS" ]; then range="${PREVIOUS}..${CANDIDATE}"; else range="-n 40 ${CANDIDATE}"; fi
            git log --first-parent --reverse --format='- %h %s' $range
          } >> "$GITHUB_STEP_SUMMARY"
```

Green run: `node tools/check-release-workflows.mjs` prints nothing and exits 0, and `npm run build` ends green. The
workflow cannot run before merge (a schedule and a dispatch run only from the default branch), so the PR says so, and
the first dispatched run after merge (§5 step 2) is its first real run.

## Task 4. The documents (§5, D2)

Model: inline

Files: `README.md`.

- README "7. Netlify: the site", step 1: the site is added from this repository with production branch `production`,
  not `main`. A new step after step 3 says that `production` is moved only by the Release workflow, once a night
  (`.github/workflows/release.yml`), and that `main` is a branch deploy the team can see. If `production` does not
  exist yet, dispatch **Release** once from the Actions tab first.
- README "9. After the first deploy", the "Every later deploy" bullet: "Netlify deploys `main` by itself" becomes "the
  Release workflow moves the site once a night, or when you dispatch it". Add: "Migrations and functions are not in
  the release yet. They join it when the first instance is deployed (issue #243)."
- `docs/plans/port-manifest.md` is a record of the first port and is left as written. What this change copies from
  currents, and what it leaves behind, is recorded in the design (§3, §4 and D6) and in each copied file's header
  comment.

## Review focus

- R6's search for `production` must not miss a push written another way (a `git push` with `HEAD:production`, or a
  refspec in a variable) and must not flag a comment that only mentions the word.
- `inputs.ref` on a `pull_request` event: confirm a PR run still checks out the PR's merge ref, not the default
  branch.
- `report`'s `git log` on the first release, with no previous production: the `-n 40` form must not break the range
  word-splitting.
- The schedule fires on a day with no merge: `candidate` ends green and every later job is skipped, not failed, so the
  owner gets no email.
- A queued second release (`cancel-in-progress: false`) after the first promoted: its candidate equals production, so
  it ends as "nothing to release" rather than pushing again.
