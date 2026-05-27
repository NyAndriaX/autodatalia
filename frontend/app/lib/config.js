export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || "",
  // Sent as `Authorization: Bearer <token>` to gated routes (/generate,
  // /transform, /upload, mutating /posts). Empty = backend is in open mode.
  backendAuthToken: process.env.NEXT_PUBLIC_BACKEND_AUTH_TOKEN || "",
};
