# Front-End Handoff Documentation (`PassFront.md`)

This document serves as the "source of truth" for the current state of the DATALIA Marketing Automation front-end dashboard. It provides all necessary information for future developers (or AI agents) to understand the architecture, what is currently built, and what specifically needs to be modified or implemented in upcoming development days.

---

## 1. Technology Stack
* **Framework:** Next.js 16.2.6 (App Router)
* **Styling:** Tailwind CSS v4 + PostCSS
* **State Management:** Redux Toolkit (`@reduxjs/toolkit`) + React-Redux
* **Icons:** `lucide-react`
* **Utilities:** `clsx` (for conditional classnames)
* **Design Theme:** Light blue-ish SaaS theme defined strictly via CSS variables in `app/globals.css`.

---

## 2. Project Architecture & State Management

The application heavily relies on Redux Toolkit for state management, which is cleanly separated from the UI components.

### Redux Slices (`app/store/`)
1. **`uiSlice.js`**: Manages global UI states.
   * `sidebarCollapsed`: Boolean for sidebar state.
   * `activeView`: Current active route (e.g., `"creation"`, `"calendar"`, `"library"`).
   * `searchQuery`: Global search input.
   * `notifications`: Array of incoming alerts (designed to hook into webhooks).
2. **`editorSlice.js`**: Manages the core post creation state.
   * `currentPost`: The primary object containing the text content, selected platforms, posting mode, status (draft/pending/approved/error), and hashtags. **This object's structure maps exactly to the expected JSON payload for Airtable and n8n webhooks.**
   * `aiGeneration`: Manages the loading state and variants returned by the AI.

---

## 3. Current Implementation (What is Built)

### Components (`app/components/`)
* **`layout/Sidebar.js`**: Main navigation. Fully responsive with collapse/expand animations.
* **`layout/Topbar.js`**: Contains global search, user profile, and a Telegram Bot connection status indicator.
* **`views/CreationEditor.js`**: The core deliverable for Day 1. It is a split-screen view containing:
  * **Left Panel**: Mode selector, platform toggles, textarea with real-time character/hashtag counters, AI Quick Actions, and the "Generate via AI" button.
  * **Right Panel**: A dynamic Live Preview displaying mockups formatted to the specific aspect ratios of the selected platforms (e.g., 9:16 for TikTok, 1:1 for Instagram).
* **`views/PlaceholderView.js`**: A reusable UI for views that are planned but not yet built (Calendar, Media Library, Analytics, Settings).

---

## 4. Pending Integrations (What Needs to be Modified)

The current UI is fully functional but relies on mock data. Future developers must replace the mocks with actual API integrations.

### A. AI Generation Endpoint
In `app/components/views/CreationEditor.js`, the AI generation is currently mocked by the `simulateAI()` function.
* **Action Required:** Replace `simulateAI()` with an actual `fetch()` or Redux `createAsyncThunk` call to the Python FastAPI backend (e.g., the LLM Router or the OpenRouter Caption API at `http://localhost:8000/captions/generate`).
* **Implementation Note:** The UI already handles the `isGenerating` loading state via Redux (`dispatch(startGeneration())`).
* **Template Logic:** When "From Template" mode is active, the chosen template is *not* injected directly into the textarea. Instead, a dropdown appears for template selection. This selected template ID must be tied to the AI endpoint and passed as *context/remarks* to the backend during generation, while the textarea remains available for specific user instructions.

### B. Action Buttons (n8n Webhooks)
In `app/components/views/CreationEditor.js`, the footer buttons ("Save as Draft", "Submit for Validation", "Publish Now") currently do nothing.
* **Action Required:** Attach `onClick` handlers to these buttons. They should dispatch the Redux `currentPost` object as a JSON payload via POST requests to your n8n webhook URLs.

### C. Telegram Status Indicator
In `app/components/layout/Topbar.js`, the Telegram connection status is hardcoded as a green indicator.
* **Action Required:** This needs to be wired to a real-time state (e.g., polling or WebSockets) to show whether the user's Telegram Bot is actively connected and listening.

---

## 5. Upcoming Views (What Needs to be Built)

Future sprints (Day 2+) must build out the views currently utilizing `PlaceholderView.js`:

1. **Calendar & Scheduling (`activeView: "calendar"`)**
   * **Requirements:** Implement an interactive calendar (e.g., using `react-big-calendar` or `FullCalendar`). It must support Drag & Drop. Dropping a post on a new date must update the Redux `scheduledDate` and trigger an API call to Airtable.
   * **Styling:** Use the predefined platform colors from `globals.css` (e.g., `--platform-facebook`) to color-code calendar events.
2. **Media & Templates (`activeView: "library"`)**
   * **Requirements:** Build a grid layout for asset management with drag-and-drop file upload. Must include an endpoint integration to fetch AI-generated videos/images from the ComfyUI/LTX backend.
3. **Analytics & API Costs (`activeView: "analytics"`)**
   * **Requirements:** Implement charts (using `Recharts` or `Chart.js`). Must fetch data from the Airtable `Token_Logs` table to display LLM token usage and generation costs.
4. **Settings & Integrations (`activeView: "settings"`)**
   * **Requirements:** Build forms for managing OAuth connections (Meta, TikTok, LinkedIn), storing AI API keys, and a linking interface for the Telegram Chat ID via BotFather.

---

## 6. Design System Guidelines
* **Do NOT use random Tailwind arbitrary values** (e.g., `bg-[#123456]`).
* Always use the CSS variables defined in `app/globals.css`. 
* The theme was recently updated to a **Light Blue** palette. Backgrounds use `var(--bg-primary)` (`#f0f4f8`), cards use `var(--bg-card)` (`#ffffff`), and primary accents use `var(--accent-primary)` (`#3b82f6`).
* When building new components, utilize the existing utility classes like `.btn-primary`, `.btn-secondary`, `.glass-card`, and `.input-field` to maintain design consistency.
