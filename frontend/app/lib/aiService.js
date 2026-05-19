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

// Entry point for prompt-driven generation.
// Currently falls back to mock because the backend only captions server-side images.
// When a /generate endpoint is added, replace this one function.
export async function generateContent({ prompt, platforms, template } = {}) {
  if (!config.apiBaseUrl) {
    await mockDelay();
    return MOCK_VARIANTS;
  }
  try {
    const data = await apiFetch("/generate", {
      method: "POST",
      body: JSON.stringify({ prompt, platforms, template }),
    });
    if (!Array.isArray(data?.variants) || !data.variants.length) throw new Error("empty");
    return data.variants;
  } catch {
    await mockDelay();
    return MOCK_VARIANTS;
  }
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

export async function applyQuickAction(content, action) {
  await mockDelay(600);
  const fn = TRANSFORMS[action];
  return fn ? fn(content) : content;
}
