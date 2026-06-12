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
- LinkedIn posting currently supports member text posts and single-image posts.
- LinkedIn video posting is not wired yet.
