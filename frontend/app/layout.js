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
        {/* Set the theme before first paint to avoid a light/dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ReduxProvider>{children}</ReduxProvider>
      </body>
    </html>
  );
}
