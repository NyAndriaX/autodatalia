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

## Auth (never embed a token in a remote URL)

> ⚠️ **Security incident notice.** An earlier version of this file contained a
> live GitLab personal access token (`glpat-…`) written in plaintext in the
> `origin` remote URL. **Committing a credential to the repository is a security
> incident.** Anyone with read access to any branch (or to the GitHub mirror) has
> that token. If you are reading this and such a token ever existed:
>
> 1. **Treat it as fully compromised.** Assume it has leaked.
> 2. **Rotate it immediately on GitLab** — User Settings → Access Tokens →
>    revoke the leaked token, then issue a fresh one. Do this *before* anything
>    else; revocation is the only thing that actually stops the leak.
> 3. **Scrub it from history** if it was ever committed (`git filter-repo` /
>    BFG), then force-push the cleaned history.
> 4. **Never put the new token in a remote URL** (it lands in `.git/config` and
>    shows up in `git remote -v`).

Configure auth out-of-band instead of in the URL:

- **GitHub**: fine-grained PAT (repo `DataliaAuto`, Contents: read/write) supplied
  via a credential helper, not the URL. An in-memory cache is set locally
  (`git config --local credential.helper 'cache --timeout=1800'`), so the
  token is **not** written to `.git/config`.
- **GitLab**: authenticate with a **git credential helper** (the OS keychain /
  `credential.helper`) **or an SSH key** — *not* a token baked into the `origin`
  URL. Keep the remote as a clean `https://gitlab.com/…/autodatalia.git`
  (or `git@gitlab.com:…` for SSH) and let the helper supply the credential.

If the available SSH key is passphrase-encrypted and can't be used
non-interactively, add it to an `ssh-agent` once per session (`ssh-add`) rather
than falling back to a token embedded in the URL.
