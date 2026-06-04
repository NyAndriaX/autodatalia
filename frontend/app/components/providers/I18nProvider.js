"use client";

/**
 * I18n provider — feeds next-intl's NextIntlClientProvider with the
 * locale + message bundle picked by `useLocaleSelector`. Sits inside
 * ReduxProvider so the language switcher can write the chosen locale
 * to Redux and have the provider re-render with the new bundle.
 *
 * Locale resolution order:
 *   1. localStorage["datalia-locale"] (last manual choice)
 *   2. navigator.language prefix matching a known bundle
 *   3. "en" fallback
 */
import { useEffect, useMemo, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useSelector, useDispatch } from "react-redux";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { setLocale } from "../../store/uiSlice";

const BUNDLES = { en, fr };
const SUPPORTED = ["en", "fr"];
const DEFAULT_LOCALE = "en";
const STORAGE_KEY = "datalia-locale";

function pickInitialLocale() {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {
    /* private mode — ignore */
  }
  const navLocale = (navigator.language || "").slice(0, 2).toLowerCase();
  return SUPPORTED.includes(navLocale) ? navLocale : DEFAULT_LOCALE;
}

export default function I18nProvider({ children }) {
  const dispatch = useDispatch();
  const reduxLocale = useSelector((s) => s.ui.locale);
  // Hold the locale in local state until the client mounts; SSR always
  // renders with DEFAULT_LOCALE to avoid hydration mismatch (we don't
  // know the user's locale at server time).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const picked = pickInitialLocale();
    if (picked !== reduxLocale) dispatch(setLocale(picked));
    queueMicrotask(() => setMounted(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever Redux flips.
  useEffect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, reduxLocale);
      document.documentElement.lang = reduxLocale;
    } catch {
      /* ignore */
    }
  }, [reduxLocale, mounted]);

  const effective = mounted ? reduxLocale || DEFAULT_LOCALE : DEFAULT_LOCALE;
  const messages = useMemo(() => BUNDLES[effective] || BUNDLES.en, [effective]);

  return (
    <NextIntlClientProvider
      locale={effective}
      messages={messages}
      // Pin the timezone so server + client agree during hydration —
      // the editor renders dates inside formatter calls, so a divergence
      // here would generate a hydration warning.
      timeZone="UTC"
      now={new Date()}
    >
      {children}
    </NextIntlClientProvider>
  );
}

export const SUPPORTED_LOCALES = SUPPORTED;
