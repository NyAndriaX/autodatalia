import Script from "next/script";
import "./globals.css";
import ReduxProvider from "./components/providers/ReduxProvider";
import I18nProvider from "./components/providers/I18nProvider";

export const metadata = {
  title: "DATALIA — Automatisation Marketing",
  description:
    "Tableau de bord IA pour la création, la planification et la publication de contenu sur toutes les plateformes sociales.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="fr"
      className="h-full antialiased"
      style={{
        "--font-inter":
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        "--font-jakarta":
          "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      } as any}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col"
        style={{
          fontFamily: "var(--font-inter)",
          fontSize: "15px",
        }}
      >
        {/*
          Charge le script no-flash AVANT React pour éviter le flash de thème.
          Utiliser <Script src=... strategy="beforeInteractive"> (fichier externe dans /public)
          évite l'avertissement React "script tag while rendering" et le mismatch SSR/client
          que provoquerait un <script dangerouslySetInnerHTML>.
        */}
        <Script src="/no-flash-theme.js" strategy="beforeInteractive" />
        <ReduxProvider>
          <I18nProvider>{children}</I18nProvider>
        </ReduxProvider>
      </body>
    </html>
  );
}
