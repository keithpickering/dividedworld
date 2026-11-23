# Merging

Incident. On 2026-10-30 a planning session was dispatching build sessions through the glass build plan
(`docs/plans/2026-10-30-glass-build-plan.md`), and every part's PR waited on the owner to merge it before the next
part could start from main. The owner, in that session: "To clarify in case you need explicit permission, I will allow
you to merge these PRs as they come in. The app is not deployed anywhere so there is no risk involved." The
permission is held to what the owner gave it for: build and plan PRs while nothing is deployed. A change to the rules
themselves stays the owner's to merge.

Incident. Rewritten on 2026-11-22. A test instance of Divided World had been deployed for some time, so the bullet's
condition "while no instance is deployed" was already false while merges went on under it. The coordinating session
asked whether to keep merging or to hold each merge. The condition is now players, not deployment, and it ends where
"Nobody is waiting on a hotfix" ends: when the owner says the game has players. Merging changes no deployed database,
so the bullet says that a migration reaches an instance only on the owner's go-ahead. The owner's own PRs are included
because the owner had been asking for them to be merged by name (#916, #981).

The owner's words. "We do have an instance deployed albeit only as a test. Claude.md is a bit outdated there" and "You
can go ahead and rewrite the rule and put it up as a PR, treat it as standing permission for the time being" (the
owner, 2026-11-22).
