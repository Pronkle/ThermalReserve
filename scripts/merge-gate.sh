#!/bin/bash
# usage: merge.sh <remote-branch>
# Merges origin/<branch> onto origin/main in a detached HEAD without committing, runs the three
# checks, and commits only if all pass. On any failure the merge is aborted. Never pushes.
set -u
cd "$(dirname "$0")/.."
[ -n "${TMPDIR:-}" ] || TMPDIR=/tmp
b="$1"
git fetch -q origin 2>/dev/null
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "DIRTY TREE"; exit 2; }
git switch -q --detach origin/main || exit 2
if ! git merge --no-ff --no-commit "origin/$b" >/dev/null 2>&1; then
  echo "CONFLICT in:"; git diff --name-only --diff-filter=U; git merge --abort; echo "(aborted)"; exit 3
fi
git diff --cached --stat | tail -1
npm install 2>&1 | grep -E "added|up to date|npm error" ; i=${PIPESTATUS[0]}
npm test > "$TMPDIR/test.log" 2>&1; t=$?
grep -E "Test Files|Tests |No test|FAIL|AssertionError" "$TMPDIR/test.log" | head -20
npm run build -w apps/web > "$TMPDIR/build.log" 2>&1; bld=$?
tail -3 "$TMPDIR/build.log"
echo "install=$i test=$t build=$bld"
if [ "$i$t$bld" != "000" ]; then git merge --abort; echo "CHECKS FAILED: merge aborted, nothing committed"; exit 4; fi
git add -u
git commit -q -m "merge: $b into main

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
echo "READY: $(git log --oneline -1)  -> push with: git push origin HEAD:main"
