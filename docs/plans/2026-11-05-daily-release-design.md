# A daily release: main is staging, production moves once a day: design

Record, written 2026-11-05. The design session's decisions, made with the owner, for moving dw.gripe's production
deploy from every merge to once a day. The plan is `docs/plans/2026-11-05-daily-release-plan.md`. The follow-up for
schema and functions is issue #243.

## 1. The problem

The Netlify team "Jamacha" (plan `nf_team_pro`, created 2026-09-08, so it is on credit-based pricing) holds three
sites: `dividedworld`, `mycurrents` and `jamacha`. In credit-based pricing only a successful production deploy costs
anything (15 credits). Deploy Previews, branch deploys and failed deploys cost nothing. That is Netlify's "How credits
work", as currents' daily-release design read it on 2026-10-14. The team hit its limit in the current billing period,
with about 230 production deploys.

The other two sites already release once a day:

| Site | Production branch moved by | Since |
|---|---|---|
| jamacha | `promote.yml`, which fast-forwards `main` from `staging` at 06:00 UTC | 2026-09-11 |
| mycurrents | `release.yml`, which fast-forwards `production` from `main` at 04:47 UTC | 2026-10-14 |
| dividedworld | Netlify builds every push to `main` | (per merge) |

Divided World took 53 first-parent commits on `main` from 2026-11-01 to 2026-11-05, about 10 a day. At that pace it
spends about 300 production deploys a month by itself. With all three sites on dailies the ceiling is about 90 a
month. Most of this period's 230 were probably currents' last week before its own switch, but that backlog does not
come back next period, and Divided World replaces it.

The game is pre-alpha with no players (CLAUDE.md, "Nobody is waiting on a hotfix"), so a deploy on every merge buys
nothing a daily one does not.

## 2. Decisions (the owner, 2026-11-05)

- **D1. Main is staging (currents' shape).** Pull requests keep merging to `main`. Netlify branch-deploys `main` for
  free, visible only to the team (the site's `requiresSSOTeamLogin` is `all`). A new branch, `production`, is Netlify's
  production branch, and only the release moves it.
  - *Rejected:* jamacha's shape, with a `staging` default branch and `main` as production. It would change every PR's
    base, both session skills and every document that says "main", for the same deploy count.
  - *Rejected:* a release by hand only. It spends the fewest deploys, but production drifts until someone remembers.
- **D2. The release moves the site alone for now.** It runs Build, SQL and Web on main's head, then fast-forwards
  `production`. Migrations and Edge Functions stay manual, as README's "After the first deploy" says, until the first
  instance is deployed. Then a design session adds `schema` and `functions` jobs ahead of `promote`, in currents'
  order. The owner agreed to this "as long as we don't forget to do it", so it is issue #243, linked from the README's
  deploy steps.
  - *Rejected:* porting currents' whole chain now. It needs Supabase secrets in Actions, and there is no deployed
    project to test it against.
  - *Rejected:* a bare fast-forward with no CI. PR CI gates each merge alone, but two green merges can still combine
    into a red `main`, and the release is the one place that is caught before players see it.
- **D3. Only the owner dispatches a release.** `workflow_dispatch` takes no input and always releases main's head.
  Sessions never move production, so CLAUDE.md gains no standing permission. Currents' D8, which lets a session
  dispatch and then tell the owner, was weighed and declined.
- **D4. The schedule is `13 5 * * *` UTC**: 22:13 PDT, or 21:13 PST after the clocks change. That falls after the
  day's merges, so a red release waits for the owner in the morning. It is off the hour, and off currents' 04:47, so
  the two releases do not queue behind each other's runners.
- **D5. A red job holds the release.** Production stays where it is, the run goes red and GitHub emails the owner, and
  the `report` job names the failed job. The fix goes forward. There is no automatic fallback to an older green commit,
  because that would silently leave out work the owner expects (currents' D6, carried).
- **D6. The guard is carried from currents, cut down.** `tools/check-release-workflows.mjs` and its test hold the
  shape below, so it cannot drift quietly. Currents' state paths, ignore script, alive check and cockpit reference stay
  behind.
- **D7. The cutover is the owner's, in Netlify.** No session touches a deployed service (CLAUDE.md, "A standing
  permission is written down"). The order is in section 5.

## 3. The release

`.github/workflows/release.yml`, new.

- **Triggers.** `schedule: 13 5 * * *` and a bare `workflow_dispatch`.
- **Concurrency.** `{ group: release, cancel-in-progress: false }`. Two releases never overlap, and a queued one waits.
- **Jobs.** Each job `needs:` the one before it, so a red job stops everything after it.
  1. `candidate`: reads main's head and `production`'s head through the API. If they are equal, it writes "Nothing to
     release" to the run summary, and every later job is skipped by `if: needs.candidate.outputs.same != 'true'`. A
     missing `production` ref (the first release) counts as "not equal". Carried from currents unchanged.
  2. `build`: calls `build.yml` with `ref: <candidate>`.
  3. `sql`: calls `sql.yml` with the same ref.
  4. `web`: calls `web.yml` with the same ref.
  5. `promote`: `git push origin <sha>:refs/heads/production`, never `--force` and never a `+` refspec, so
     `production` only fast-forwards along `main`. Its permissions are `contents: write` and nothing else. The first
     run creates the branch. Netlify sees the push and builds production.
  6. `report`: `if: always()` after a real candidate. It writes the candidate, the previous production SHA, the
     first-parent commits between them and any failed job to the run summary. It reads nothing but the repository, so
     its permissions are `contents: read` alone (currents' Netlify-status lookup stays behind: here the release's own
     Build is the site build's guard).
- **The called workflows.** `build.yml`, `sql.yml` and `web.yml` each gain a `workflow_call` trigger with one
  required string input, `ref`, and their checkout reads `ref: ${{ inputs.ref }}`. On a pull request `inputs.ref` is
  empty, and `actions/checkout` falls back to the event's ref as it does today. Their `if:` and `concurrency` already
  treat a non-PR event as a single run, and `paths-ignore` applies only to `pull_request`, so a docs-only day still
  gets the whole chain.
- **Cost.** One Netlify production deploy a day at most, and none on a day with no merge. Actions spends about 30
  runner minutes a release (Web's e2e is most of it), and nothing on the days with no merge.

## 4. The guard

`tools/check-release-workflows.mjs`, with `problems(files)` pure and exported, and `tools/test-release-workflows.mjs`,
which plants each poison on a copy of the real files. It adds `yaml` as a devDependency, at currents' range. It holds:

- R1. `release.yml` has the jobs `candidate`, `build`, `sql`, `web`, `promote` and `report`, and the chain
  `build → sql → web → promote` is unbroken in `needs`.
- R2. `build`, `sql` and `web` call `./.github/workflows/{build,sql,web}.yml` with `ref` set to
  `${{ needs.candidate.outputs.sha }}`.
- R3. `promote` never forces (no `--force`, `--force-with-lease`, `-f` or `+` refspec), pushes to
  `refs/heads/production`, and asks `contents: write` and nothing else.
- R4. `release.yml` runs on a `schedule` and a `workflow_dispatch` with no inputs, and on nothing else.
- R5. `build.yml`, `sql.yml` and `web.yml` each take `workflow_call` with a required `ref`, and check out
  `inputs.ref`.
- R6. No workflow but `release.yml` names `refs/heads/production` or `production` as a push target, and no workflow
  runs on `push`.
- R7. `netlify.toml` has no `[context.*]` table that sets its own `command`, so production builds what a branch deploy
  builds.

## 5. The cutover (the owner's, in order)

1. Merge the build PR. Nothing changes yet, because Netlify still builds `main` to production.
2. Dispatch **Release** once from the Actions tab. It creates `production` at main's head.
3. In Netlify, under **Site configuration > Build & deploy > Branches and deploy contexts**, set the production branch
   to `production`. Set branch deploys to "Let me add individual branches" with `main`, or to all branches. Deploy
   Previews stay on.
4. From then on a merge to `main` builds a free branch deploy at `main--dividedworld.netlify.app`, and dw.gripe moves
   once a night.

Until step 3, `main` keeps deploying to production, so steps 1 and 2 are safe in either order. Once the release is
merged, README step 7 says to pick `production`, so a deploy from nothing comes out right.

## 6. The rules this touches

- **No player is ever stuck.** It adds no state a player, a character or a post can be in.
- **A response never proves a private fact.** It adds no response, payload, event or timing.
- **The layers.** This is repository tooling, neither engine nor instance. It names no instance.
- **Two lists that must agree are one list.** The release calls the same workflow files as a PR, so there is no second
  copy of the build's commands.
- **A guard that has never been red.** R1 to R7 each have a poison in the test.
- **This repository copies; it never imports.** `release.yml`'s candidate step and the guard are copies from
  currents. This design is their record: `docs/plans/port-manifest.md` is the first port's record and stays as
  written. Each copied file's header comment names where it came from.
- **Merging.** Unchanged. The build PR does not touch CLAUDE.md.

## 7. Open

- The schema and functions jobs (issue #243).
- Whether `main`'s branch deploy should one day point at its own Supabase project rather than production's. There is
  no instance yet, so there is nothing to decide.
