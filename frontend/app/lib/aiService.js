import { apiFetch } from "./apiClient";
import { config } from "./config";

const MOCK_VARIANTS = [
  {
    id: 1,
    text: "🚀 Elevate your brand with our cutting-edge marketing solutions! We transform ideas into impactful campaigns that drive real results.\n\n✨ Data-driven strategy\n📈 Multi-platform reach\n🎯 Targeted audience engagement\n\nReady to grow? Let's connect! 💬\n\n#MarketingAutomation #DigitalMarketing #BrandGrowth #ContentStrategy",
    tone: "Engaging & Professional",
  },
  {
    id: 2,
    text: "Your brand deserves to be seen. 👀\n\nWe don't just post content—we craft stories that resonate, engage, and convert.\n\nFrom strategy to execution, we handle it all so you can focus on what matters most: your business.\n\n📩 DM us to start your journey.\n\n#SocialMediaMarketing #GrowthHacking #ContentCreation",
    tone: "Direct & Compelling",
  },
  {
    id: 3,
    text: "Did you know? 📊\n\n73% of marketers say social media has been \"very effective\" for their business.\n\nBut effectiveness isn't about posting more—it's about posting smarter.\n\nHere's how we help:\n→ AI-powered content generation\n→ Optimal scheduling across platforms\n→ Real-time performance analytics\n\nThe future of marketing is automated. Are you ready?\n\n#MarketingTips #AIMarketing #AutomationTools",
    tone: "Educational & Authoritative",
  },
];

function mockDelay(ms = 1200) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Token conservation ─────────────────────────────────────────────────
// Every real AI call costs money. We never call the model when the request
// is identical to the previous one — the result is memoized and returned
// instantly with zero tokens spent. A `force` flag lets the user explicitly
// pay for a fresh generation.

const MAX_PROMPT_CHARS = 2000; // bound input tokens regardless of textarea size
const ZERO_USAGE = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
const CACHE_KEY = "datalia.ai.genCache.v2";

// Normalize so cosmetic edits (extra spaces, case, trailing newline) map to
// the SAME signature → trivial changes reuse the cached result, no re-prompt.
// Exported for unit tests; treat as an implementation detail elsewhere.
export function generationSignature({
  prompt,
  platforms,
  template,
  variants = 1,
  image = null,
  tone = null,
} = {}) {
  const active = Object.keys(platforms || {})
    .filter((k) => platforms[k])
    .sort()
    .join(",");
  const norm = (prompt || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROMPT_CHARS);
  return `${norm}|${active}|${template || ""}|${variants}|${image || ""}|${tone || ""}`;
}

// Cache persists across reloads so a refresh never re-bills a prompt.
function loadGenCache() {
  if (typeof window === "undefined") return { sig: null, variants: null };
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY)) || { sig: null, variants: null };
  } catch {
    return { sig: null, variants: null };
  }
}
let _genCache = loadGenCache();
function saveGenCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(_genCache));
  } catch {
    /* quota/private mode — in-memory cache still works */
  }
}

/** True when generate() would return a cached result (no tokens). */
export function isGenerationCached(args) {
  return _genCache.sig !== null && _genCache.sig === generationSignature(args);
}

// Prompt-driven generation. Short-circuits to the cached result for an
// unchanged (or only cosmetically-changed) request; only hits the backend
// on first run, a real change, more variants, or an explicit `force`.
// Returns { variants, usage, cached }.
export async function generateContent({
  prompt,
  platforms,
  template,
  variants: variantCount = 1,
  image = null,
  tone = null,
  force = false,
} = {}) {
  const sig = generationSignature({
    prompt,
    platforms,
    template,
    variants: variantCount,
    image,
    tone,
  });
  if (!force && _genCache.sig === sig && _genCache.variants) {
    return { variants: _genCache.variants, usage: ZERO_USAGE, cached: true };
  }

  let variants;
  let usage = ZERO_USAGE;
  let model = null;
  if (!config.apiBaseUrl) {
    await mockDelay();
    variants = MOCK_VARIANTS.slice(0, variantCount);
  } else {
    try {
      const data = await apiFetch("/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: (prompt || "").slice(0, MAX_PROMPT_CHARS),
          platforms,
          template,
          tone, // backend may forward to the LLM Router as a style hint
          variants: variantCount,
          image_filename: image,
        }),
      });
      if (!Array.isArray(data?.variants) || !data.variants.length) throw new Error("empty");
      variants = data.variants;
      usage = data.usage || ZERO_USAGE;
      model = data.model || null;
    } catch {
      await mockDelay();
      variants = MOCK_VARIANTS.slice(0, variantCount);
    }
  }
  _genCache = { sig, variants };
  saveGenCache();
  return { variants, usage, model, cached: false };
}

// Transform existing content with a quick AI action.
// Runs locally until the backend exposes a /transform endpoint.
const TRANSFORMS = {
  shorten: (t) => t.split("\n\n").slice(0, 2).join("\n\n"),
  expand: (t) =>
    t + "\n\n💡 Want to learn more? Follow us for daily insights and behind-the-scenes content!",
  "tone-casual": (t) =>
    t.replace(/\.\s/g, "! ").replace(/\bWe are\b/g, "We're").replace(/\bIt is\b/g, "It's"),
  "tone-pro": (t) =>
    t.replace(/!/g, ".").replace(/🚀|👀|💬|📩|😊/g, "").replace(/\n{3,}/g, "\n\n").trim(),
};

// Quick actions run LOCALLY (zero tokens) by design — spamming shorten/
// expand/tone costs nothing. Results are also memoized per (action, text)
// so repeats are instant, and so this stays free if it's ever pointed at
// the backend /transform endpoint.
const _qaCache = new Map();

export async function applyQuickAction(content, action) {
  const key = `${action}::${content}`;
  if (_qaCache.has(key)) return _qaCache.get(key);

  await mockDelay(600);
  const fn = TRANSFORMS[action];
  const result = fn ? fn(content) : content;

  if (_qaCache.size > 50) _qaCache.clear(); // simple bound
  _qaCache.set(key, result);
  return result;
}
