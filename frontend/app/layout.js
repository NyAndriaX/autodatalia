import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import ReduxProvider from "./components/providers/ReduxProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "DATALIA — Marketing Automation Dashboard",
  description:
    "AI-powered multi-platform content creation, scheduling, and analytics dashboard for modern marketing teams.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* No-flash theme bootstrap.
            Lives as a static file in /public so <Script src=...> hoists it
            out of the React tree. Any inline <script> rendered through
            JSX — including <Script>{`...`}</Script> or
            <script dangerouslySetInnerHTML> — triggers React 19's
            "Encountered a script tag while rendering React component"
            warning, because React can't execute scripts after hydration.
            External <Script src=... strategy="beforeInteractive"> sidesteps
            both that warning and the resulting hydration mismatch: Next.js
            injects a real <script src=...> tag into the HTML stream so the
            browser fetches + runs it before React even mounts. */}
        <Script src="/no-flash-theme.js" strategy="beforeInteractive" />
        <ReduxProvider>{children}</ReduxProvider>
      </body>
    </html>
  );
}
