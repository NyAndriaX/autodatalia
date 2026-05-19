import { apiFetch } from "./apiClient";
import { config } from "./config";

// Mock corpus — replace with backend results when /search exists.
const MOCK_INDEX = [
  { id: "p1", type: "post", title: "Summer launch teaser", subtitle: "Draft · Instagram, Facebook" },
  { id: "p2", type: "post", title: "Q3 results recap", subtitle: "Published · LinkedIn" },
  { id: "t1", type: "template", title: "Summer Promo Template", subtitle: "Brand template" },
  { id: "t2", type: 'template', title: 'Educational "Did you know?"', subtitle: "Brand template" },
  { id: "m1", type: "media", title: "hero-banner.png", subtitle: "Image · 1920×1080" },
  { id: "m2", type: "media", title: "product-demo.mp4", subtitle: "Video · 0:32" },
];

function mockSearch(query) {
  const q = query.trim().toLowerCase();
  return new Promise((resolve) =>
    setTimeout(() => {
      if (!q) return resolve([]);
      resolve(
        MOCK_INDEX.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.subtitle.toLowerCase().includes(q) ||
            item.type.includes(q)
        )
      );
    }, 250)
  );
}

// Search across posts / templates / media.
// Swap this one function's body when the backend exposes /search.
export async function search(query) {
  if (!query.trim()) return [];
  if (!config.apiBaseUrl) return mockSearch(query);
  try {
    const data = await apiFetch(`/search?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(data?.results)) throw new Error("bad shape");
    return data.results;
  } catch {
    return mockSearch(query);
  }
}
