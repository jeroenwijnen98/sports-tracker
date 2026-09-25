# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. The sandbox installed its dependencies *before* the merge, so a branch that added
   one is missing it here. If the merge touched `package.json` or `package-lock.json`,
   run `npm ci --no-audit --no-fund`. A `Cannot find module` after a merge is this,
   not a bug on the branch.
4. Then run `npm run typecheck` (if the script exists) and the smoke boot from
   `.sandcastle/implement-prompt.md` once, saving output (`2>&1 | tee /tmp/merge-checks.log`)
   and reading that file again instead of rerunning.
5. If a check fails, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each branch that was merged, close its issue using the following command:

`gh issue close <ID> --comment "Completed by Sandcastle"`

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
