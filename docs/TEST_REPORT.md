# Test Report

**Date:** 2026-06-17
**Branch:** `github-workspaces-rbac`

## Scope

Validation and fixes for:

- Zernio request error handling
- Zernio unit coverage for upstream network failures
- Workspace leave-flow expectations under the current multi-workspace model

## Code changes

- `backend/app/zernio.py`
  - Catch `httpx.HTTPError` in the Zernio request helper.
  - Re-raise as a clean `ZernioError(..., status=502)` so upstream network issues surface predictably.
- `backend/tests/test_zernio.py`
  - Added coverage for network/connect failures in the Zernio client path.
- `backend/tests/test_workspaces_rbac.py`
  - Updated `test_member_leaves_workspace` to match the actual product behavior:
    after leaving a shared workspace, a user falls back to their own personal workspace.

## Validation run

### Full backend suite

Command:

```bash
docker compose -f infra/docker-compose.yml exec -T caption-api python -m pytest tests -q
```

Result:

- `98 passed`
- `1 warning`

### Focused verification

Command:

```bash
docker compose -f infra/docker-compose.yml exec -T caption-api python -m pytest tests/test_zernio.py tests/test_workspaces_rbac.py::test_member_leaves_workspace -q
```

Result:

- `11 passed`

## Live smoke check

Endpoint tested:

- `GET /oauth/zernio/instagram/start`

Result:

- `200 OK`
- returned a real `authorize_url`

## Notes

- `sshkey.txt` was intentionally left untracked and was not included in the push.
