// Streaming upload proxy — bypasses the Next.js dev rewrite, which
// buffers multipart bodies in memory and times out at 30s for files
// larger than ~5-10MB. Confirmed in this repo: a 48MB MP4 returns
// HTTP 500 after exactly 30s through the rewrite, but completes in
// ~4s when the body is streamed straight through to the backend.
//
// We use `fetch()` with the request's `ReadableStream` body directly
// (`duplex: 'half'`) so Node never holds the full file in memory. The
// upstream response is also streamed back. This is the canonical Next.js
// App Router pattern for proxying large uploads.

export const runtime = "nodejs";
// Cover the worst case of "needs transcode" — even ultrafast x264 takes
// real time on multi-minute inputs.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function backendUrl(path) {
  const base = process.env.BACKEND_INTERNAL_URL || "http://localhost:8000";
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function POST(request) {
  const target = backendUrl("/upload");

  // Forward only the headers the backend cares about. Stripping host /
  // accept-encoding / connection avoids odd interactions with the
  // upstream's HTTP/1.1 keep-alive handling.
  const forwardHeaders = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) forwardHeaders.set("content-type", ct);
  const cl = request.headers.get("content-length");
  if (cl) forwardHeaders.set("content-length", cl);
  const auth = request.headers.get("authorization");
  if (auth) forwardHeaders.set("authorization", auth);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: forwardHeaders,
      body: request.body,
      // Required when sending a streaming body via fetch in Node.
      duplex: "half",
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "upload_proxy_failed",
        detail: err?.message || String(err),
      }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      },
    );
  }

  // Stream the response body back to the browser. Preserve the backend's
  // status code and content-type so error JSON / 4xx responses surface
  // properly in `apiUpload`'s catch block.
  const respHeaders = new Headers();
  const upstreamCt = upstream.headers.get("content-type");
  if (upstreamCt) respHeaders.set("content-type", upstreamCt);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}
