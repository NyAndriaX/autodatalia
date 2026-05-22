import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ReduxProvider from "./components/providers/ReduxProvider";
import { NO_FLASH_SCRIPT } from "./lib/theme";

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
      <head>
        {/* No-flash theme: inline raw <script> in <head> so the data-theme
            attribute is set before the first paint. next/script's
            <Script strategy="beforeInteractive"> is the "official" way but
            in Next.js 16 it has to live in <head> too — and when placed
            inside React components it triggers the "Encountered a script
            tag while rendering React component" console error. A raw
            <script dangerouslySetInnerHTML> sidesteps both: the HTML
            serialiser emits a real <script> tag the browser executes
            synchronously, no React-tree script-stripping involved. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ReduxProvider>{children}</ReduxProvider>
      </body>
    </html>
  );
}
