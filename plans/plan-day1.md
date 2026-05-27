# MISSION
You are a Senior Front-End Developer expert in React, Next.js, and Tailwind CSS. Your mission is to build the User Interface (UI) for the "DATALIA Marketing Automation" dashboard. 

# 🏗 SYSTEM CONTEXT & ARCHITECTURE (Crucial)
You are building the UI for a decoupled, microservice-based architecture. You must understand how the Front-End fits into the broader stack:
* **Front-End:** React (Next.js) + Redux.
* **Database / Backend UI:** Airtable (Stores posts, users, templates, and token logs). The Front-End will read/write data here via API.
* **Business Logic & AI:** A Python (FastAPI) "LLM Router". **Rule:** The Front-End NEVER calls OpenAI/Anthropic directly. It sends payloads to the Python API, which handles prompt generation, cost optimization, and fallback logic.
* **Orchestration:** n8n (handles scheduled posts, webhooks, and pushing to social APIs).
* **Validation Loop:** A Telegram Bot. Content is sent to Telegram for human approval. The Front-End must listen for status updates (e.g., from "Draft" -> "Pending Telegram" -> "Ready to Publish").
* **Video Generation:** ComfyUI (LTX 2.3) triggered via the Python backend for asynchronous video rendering.

# 🛠 TECH STACK
* **Framework:** React.js via Next.js (App Router preferred).
* **Styling:** Tailwind CSS + Shadcn/UI components (or equivalent Radix-based components).
* **State Management:** Redux (Redux Toolkit) for managing global states like user sessions, connected platforms, and the global post queue.
* **Calendar:** FullCalendar or react-big-calendar (must support native Drag & Drop).
* **Charts:** Recharts or Chart.js (for analytics and API cost dashboards).

# 🧭 OVERALL LAYOUT STRUCTURE
Implement a modern SaaS layout:
* **Sidebar (Left):** Main navigation (Creation, Calendar, Library, Analytics, Settings).
* **Topbar:** Global search, Notifications (e.g., webhook alerts, Telegram approval pings), User Profile.
* **Main Content Area:** Dynamic views based on routing.

# 🖥 MAIN VIEWS TO DEVELOP

## 1. "Creation & Editor" View (The Core App)
* **Layout:** Split-screen interface.
* **Left Panel (Input & Controls):**
  * Mode selection: "Free Prompt", "From Template", or "From Scratch".
  * Target platform toggles (Facebook, Instagram, TikTok, LinkedIn).
  * "Generate via AI" button (Triggers the Python LLM Router API).
  * Quick AI Actions: Shorten, Expand, Change Tone.
* **Right Panel (Live Multi-Platform Preview):**
  * Mockups simulating the real UI of the target platforms (e.g., IG Square, TikTok 9:16 vertical).
  * Real-time character limits and remaining hashtag counts.
* **Action Footer:** Buttons for "Save as Draft", "Submit for Validation (Telegram)", "Publish Now".

## 2. "Calendar & Scheduling" View
* **Core Component:** Interactive Calendar (Month, Week, and Timeline/Queue views).
* **Interactions:** Full Drag & Drop. Moving a post automatically updates its scheduled date in the Redux store and pushes the update to Airtable.
* **Visual Coding:** Cards must have platform-specific color tags (FB = Blue, IG = Gradient/Pink, TikTok = Black, LinkedIn = Dark Blue).
* **Status Indicators:** Clearly show the post state (Draft = Grey, Pending Telegram = Orange, Approved/Scheduled = Green, Error = Red).

## 3. "Media & Templates" View
* **Media Library:** Grid layout with drag-and-drop file upload. Must include a dedicated tab for AI-generated assets (pulling status from the ComfyUI/LTX backend).
* **Templates:** Reusable brand kit cards (color palettes, predefined personas/tones of voice).

## 4. "Analytics & API Costs" Dashboard
* **Engagement Tab:** KPIs per social network (Reach, Likes, Comments).
* **API Cost Tab (Critical):** Visual gauges and charts reading from the Airtable `Token_Logs` table. Show LLM token usage and ComfyUI generation costs divided by user and workflow.

## 5. "Settings & Integrations" View
* **Social Connections:** OAuth buttons for Meta, TikTok, LinkedIn.
* **AI & API Keys:** Secure input forms for OpenAI/Anthropic keys.
* **Telegram Pairing:** Input field to link a Telegram Chat ID with the BotFather.

# 🚀 INITIAL DELIVERABLES & TASKS
1. Initialize the Next.js project structure with Tailwind and Redux Toolkit.
2. Create the base Layout component (Sidebar + Topbar).
3. Build the static structure for the "Creation & Editor" split-screen view.

# 📝 REPORTING INSTRUCTION (compteRenduDay1.txt)
At the end of your generation, you MUST create a file named `compteRenduDay1.txt` at the root of the project to track your modifications. 
**Important:** Please check the project folder for the provided report prototype/template file and use its exact structure to format your log.