# LinkedIn setup

AutoDatalia supports LinkedIn member posting through the REST Posts API.

Required LinkedIn products/scopes:
- `Share on LinkedIn` with `w_member_social`
- One identity path so the app can discover the member URN:
  - preferred: OpenID Connect scopes `openid profile email`
  - fallback: legacy `r_liteprofile`

Redirect URI:
- `${OAUTH_REDIRECT_BASE}/oauth/linkedin/callback`

Environment variables:
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- optional `LINKEDIN_SCOPES`

Recommended `LINKEDIN_SCOPES`:
```env
LINKEDIN_SCOPES=openid,profile,email,w_member_social
```

Fallback if your LinkedIn app only has legacy profile access:
```env
LINKEDIN_SCOPES=r_liteprofile,w_member_social
```

Notes:
- Each signed-in AutoDatalia user must connect LinkedIn from Settings for their own account.
- Tokens are stored server-side per user.
- LinkedIn posting supports member text posts, single-image posts, and video
  posts (chunked Videos API: initializeUpload → upload parts → finalizeUpload).
- Access tokens auto-refresh (~60-day lifetime) when the app is approved for
  programmatic refresh tokens; otherwise the user reconnects on expiry.
- Video posting is implemented but **not yet verified end-to-end** against the
  live API — pending a connected token.
