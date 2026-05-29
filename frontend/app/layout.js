import Script from "next/script";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import ReduxProvider from "./components/providers/ReduxProvider";
import I18nProvider from "./components/providers/I18nProvider";

/* Inter — police de corps : lisibilité maximale */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600"],
  display: "swap",
});

/* Plus Jakarta Sans — police d'affichage : titres et accroches */
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["600", "700", "800"],
  display: "swap",
});

export const metadata = {
  title: "DATALIA — Automatisation Marketing",
  description:
    "Tableau de bord IA pour la création, la planification et la publication de contenu sur toutes les plateformes sociales.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="fr"
      className={`h-full antialiased ${inter.variable} ${plusJakarta.variable}`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col"
        style={{
          fontFamily: "var(--font-inter, 'Inter'), -apple-system, sans-serif",
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
