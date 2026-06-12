# Repo / branch workflow (GitHub-only note)

> This file lives **only on the `github-main` branch** and is intentionally
> never merged into `main`, so it does not reach the GitLab prod repo.

This repository is pushed to **two** remotes that are kept deliberately
different:

| Remote | URL | Branch pushed | Contents |
|---|---|---|---|
| `origin` | GitLab (`copyandprompt-automatisations/autodatalia`) | `main` | **Clean prod**: code + public docs (`README.md`, `PROJECT_STATE.md`, `DEPLOY.md`). No internal docs. |
| `github` | GitHub (`joeyfrontend/DataliaAuto`) | `github-main` (default) | **Superset**: everything in `main` **plus** the internal/working docs. |

## Why two branches instead of two `.gitignore`s

`.gitignore` is a tracked file shared by every branch and only affects
*untracked* files — it cannot "track a file on GitHub but ignore it on
GitLab." The clean way to keep internal docs off GitLab is to **commit them
only on `github-main`**, never on `main`.

Internal-only files (live on `github-main`, never on `main`):

```
AGENTS.md   CLAUDE.md   GITHUB-WORKFLOW.md
docs/linkedin.md
plans/architecture_plan.md  plans/hosting.md
plans/next-steps.md         plans/plan-day1.md
```

## Day-to-day

**Normal work → push to GitHub (your default):**
```bash
git switch github-main
# ...make changes...
git commit -am "..."
git push github github-main
```

**Promote code changes to GitLab prod (when ready):**
```bash
git switch main
git merge github-main        # brings code across; resolve so NO internal
                             # docs land on main (keep them github-only)
git push origin main
```
> Tip: if a change touches both code and internal docs, commit them
> separately so the code commit can be cherry-picked to `main` without the
> docs: `git switch main && git cherry-pick <code-commit>`.

## Auth (both remotes use HTTPS + a token)

- **GitHub**: fine-grained PAT (repo `DataliaAuto`, Contents: read/write).
  An in-memory credential cache is set locally
  (`git config --local credential.helper 'cache --timeout=1800'`), so the
  token is **not** written to `.git/config`.
- **GitLab**: existing token in the `origin` URL.

`git@`-style SSH was abandoned for this checkout because the available SSH
key is passphrase-encrypted and couldn't be used non-interactively.
