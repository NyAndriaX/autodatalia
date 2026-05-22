"""Privacy Policy + Terms of Service pages.

Served from the backend at /privacy and /terms so platforms (TikTok,
LinkedIn, Meta) can reach them during OAuth review without depending on
the marketing site being live. The HTML is intentionally minimal but
correct — the content satisfies what TikTok's audit reviewers check
for (explicit mention of TikTok data usage, what we store, how a user
disconnects) and reads as a real product, not as boilerplate.

If we ever move to a hosted marketing site (datalia.com/privacy etc.)
just redirect these to that canonical URL — every platform's dev
portal accepts the URLs we provide today, no resubmission needed.
"""

from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["legal"])

# Single source of truth so every "last updated" line shows the same
# date and no one has to remember to bump two places.
_LAST_UPDATED = datetime.now(timezone.utc).strftime("%Y-%m-%d")


_SHARED_CSS = """
<style>
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    max-width: 720px;
    margin: 40px auto;
    padding: 0 20px 80px;
    color: #0f172a;
    line-height: 1.6;
  }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 { font-size: 18px; margin-top: 28px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  code { background: #f1f5f9; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
  .nav { font-size: 13px; margin-bottom: 28px; color: #64748b; }
  .nav a { color: #4f46e5; text-decoration: none; margin-right: 14px; }
  .nav a:hover { text-decoration: underline; }
  footer { margin-top: 48px; font-size: 12px; color: #64748b; }
</style>
"""


def _wrap(title: str, body_html: str) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — Datalia</title>
  {_SHARED_CSS}
</head>
<body>
  <div class="nav">
    <a href="/privacy">Privacy Policy</a>
    <a href="/terms">Terms of Service</a>
  </div>
  {body_html}
  <footer>
    Datalia — content scheduling and AI-assisted post authoring.
    Contact: <a href="mailto:legal@datalia.app">legal@datalia.app</a>.
  </footer>
</body>
</html>"""


@router.get("/privacy", response_class=HTMLResponse)
async def privacy_policy() -> str:
    """Privacy policy page reviewers and platforms fetch."""
    body = f"""
<h1>Privacy Policy</h1>
<p class="meta">Last updated: {_LAST_UPDATED}</p>

<p>
  This Privacy Policy explains what data Datalia collects when you connect
  your social accounts to schedule and publish content through the app, how
  that data is used, and how to delete it.
</p>

<h2>1. Who we are</h2>
<p>
  Datalia is a content scheduling and AI-assisted post authoring tool for
  creators and brand teams. Datalia operates the application available at
  the URL you used to sign in. Questions about this policy can be sent to
  <a href="mailto:legal@datalia.app">legal@datalia.app</a>.
</p>

<h2>2. Data we collect from TikTok</h2>
<p>
  When you connect a TikTok account via Login Kit, we receive and store the
  following fields returned by TikTok's API:
</p>
<ul>
  <li><code>open_id</code>, <code>union_id</code> — identifiers for your TikTok account</li>
  <li><code>display_name</code>, <code>username</code>, <code>avatar_url</code> — shown in the Datalia UI so you can confirm the right account is connected</li>
  <li><code>access_token</code>, <code>refresh_token</code>, <code>scope</code>, expiry timestamps — used to publish content you explicitly schedule through the app</li>
</ul>
<p>
  When you publish a video through Datalia, we additionally store the
  <code>publish_id</code> and <code>publicly_available_post_id</code> that
  TikTok returns, plus the resulting permalink, so the Datalia calendar can
  link to the live post.
</p>

<h2>3. Data we collect from other connected platforms</h2>
<p>
  When you connect a Facebook Page, Instagram Business account, LinkedIn
  Page, or other supported platform, we store an equivalent minimum: access
  tokens, account identifiers, display names, and any URLs returned for
  successful publishes. We never collect data unrelated to publishing.
</p>

<h2>4. How we use your data</h2>
<ul>
  <li>To authenticate you and display the connected accounts in the app.</li>
  <li>To publish content <strong>only</strong> when you explicitly trigger a
      publish action or when a scheduled post you authored reaches its
      scheduled time.</li>
  <li>To show you the resulting permalinks and outcome of each publish.</li>
</ul>
<p>
  We do <strong>not</strong> use TikTok or any other connected-platform
  data for advertising, model training, analytics for third parties, or
  resale.
</p>

<h2>5. How your data is stored</h2>
<p>
  Tokens are stored on our servers and never exposed to the browser. We do
  not transfer your tokens or account data to any third party other than
  the platform they relate to (e.g. TikTok tokens are only ever sent to
  TikTok's APIs).
</p>

<h2>6. How to delete your data</h2>
<p>
  You can disconnect any connected platform from Settings → Connected
  Platforms → Disconnect. This permanently deletes the stored tokens and
  account identifiers for that platform. To delete all data associated
  with your Datalia workspace, email
  <a href="mailto:legal@datalia.app">legal@datalia.app</a>.
</p>

<h2>7. Children</h2>
<p>
  Datalia is not directed to children under 13 and does not knowingly
  collect data from them.
</p>

<h2>8. Changes</h2>
<p>
  We will update the "last updated" date at the top of this page when this
  policy changes. Material changes will also be announced in-app.
</p>
"""
    return _wrap("Privacy Policy", body)


@router.get("/terms", response_class=HTMLResponse)
async def terms_of_service() -> str:
    """Terms of Service page."""
    body = f"""
<h1>Terms of Service</h1>
<p class="meta">Last updated: {_LAST_UPDATED}</p>

<p>
  These Terms govern your use of Datalia, a content scheduling and
  AI-assisted post authoring tool. By connecting a social account or
  publishing through Datalia, you agree to these Terms.
</p>

<h2>1. The service</h2>
<p>
  Datalia lets you author original content, generate captions and hashtags
  with AI assistance, schedule posts, and publish them to social accounts
  you have explicitly connected (TikTok, Facebook, Instagram, LinkedIn).
</p>

<h2>2. Your content and accounts</h2>
<ul>
  <li>You retain all rights to the content you create with Datalia.</li>
  <li>You are responsible for ensuring you have the rights to any music,
      images, video, or text you upload, and that your posts comply with
      each connected platform's terms (including TikTok's
      <a href="https://www.tiktok.com/legal/page/global/community-guidelines/en" target="_blank" rel="noopener noreferrer">Community Guidelines</a>
      and Music Usage Confirmation requirement).</li>
  <li>You authorise Datalia to publish content on your behalf to the
      accounts you connect, only when you explicitly trigger a publish or
      when a post you scheduled reaches its scheduled time.</li>
</ul>

<h2>3. Acceptable use</h2>
<p>
  You must not use Datalia to:
</p>
<ul>
  <li>Publish content that violates a connected platform's terms.</li>
  <li>Publish spam, harassment, hate speech, or illegal content.</li>
  <li>Reverse-engineer, abuse, or interfere with Datalia's infrastructure.</li>
</ul>

<h2>4. Termination</h2>
<p>
  You may stop using Datalia and disconnect every platform at any time
  through the Settings view. We may suspend or terminate access in case of
  serious or repeated breach of these Terms.
</p>

<h2>5. Disclaimer</h2>
<p>
  Datalia is provided "as is" without warranty of any kind. We do not
  control the moderation actions taken by connected platforms and are not
  responsible for any takedown, reach reduction, or other action a
  platform takes against content published through Datalia.
</p>

<h2>6. Limitation of liability</h2>
<p>
  To the maximum extent permitted by law, Datalia's liability for any
  claim arising out of or related to these Terms is limited to the amount
  you paid for the service in the twelve months preceding the claim.
</p>

<h2>7. Changes</h2>
<p>
  We may update these Terms; we will revise the "last updated" date at the
  top of this page. Continued use of Datalia after a change constitutes
  acceptance of the updated Terms.
</p>

<h2>8. Contact</h2>
<p>
  Questions about these Terms: <a href="mailto:legal@datalia.app">legal@datalia.app</a>.
</p>
"""
    return _wrap("Terms of Service", body)
