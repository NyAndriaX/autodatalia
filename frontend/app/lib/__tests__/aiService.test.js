import { describe, expect, it } from "vitest";
import { generationSignature } from "../aiService";

describe("generationSignature", () => {
  it("returns the same signature for cosmetic prompt edits", () => {
    const a = generationSignature({
      prompt: "Launch our new product",
      platforms: { facebook: true, instagram: true },
      template: "promo",
      variants: 3,
    });
    const b = generationSignature({
      prompt: "  LAUNCH our new product\n",
      platforms: { facebook: true, instagram: true },
      template: "promo",
      variants: 3,
    });
    expect(a).toBe(b);
  });

  it("differs when the active platforms change", () => {
    const a = generationSignature({
      prompt: "hi",
      platforms: { facebook: true },
    });
    const b = generationSignature({
      prompt: "hi",
      platforms: { facebook: true, tiktok: true },
    });
    expect(a).not.toBe(b);
  });

  it("ignores disabled platforms", () => {
    const a = generationSignature({
      prompt: "hi",
      platforms: { facebook: true, tiktok: false },
    });
    const b = generationSignature({
      prompt: "hi",
      platforms: { facebook: true },
    });
    expect(a).toBe(b);
  });

  it("differs when the variant count changes", () => {
    const a = generationSignature({ prompt: "x", variants: 1 });
    const b = generationSignature({ prompt: "x", variants: 3 });
    expect(a).not.toBe(b);
  });

  it("differs when the template changes", () => {
    const a = generationSignature({ prompt: "x", template: "promo" });
    const b = generationSignature({ prompt: "x", template: "edu" });
    expect(a).not.toBe(b);
  });

  it("is platform-order independent", () => {
    const a = generationSignature({
      prompt: "x",
      platforms: { facebook: true, instagram: true },
    });
    const b = generationSignature({
      prompt: "x",
      platforms: { instagram: true, facebook: true },
    });
    expect(a).toBe(b);
  });

  it("caps the prompt length to bound token cost", () => {
    const huge = "a".repeat(5000);
    const sig = generationSignature({ prompt: huge });
    // The signature embeds the truncated prompt; it must be far shorter
    // than the raw input.
    expect(sig.length).toBeLessThan(huge.length);
  });
});
