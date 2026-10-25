// Per-device settings that never sync: the colour theme, installing to the home screen, and offline caching.

type ThemePref = "system" | "light" | "dark";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const THEME_KEY = "theme";
const THEME_COLORS = { light: "#ffffff", dark: "#131f24" };
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function readThemePref(): ThemePref {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function saveThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Private mode or blocked storage: the choice still applies until the page closes.
  }
}

function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
}

function initTheme() {
  let pref = readThemePref();
  applyTheme(pref);
  darkQuery.addEventListener("change", () => applyTheme(pref));
  const radios = document.querySelectorAll<HTMLInputElement>('#themeField input[name="theme"]');
  radios.forEach((radio) => {
    radio.checked = radio.value === pref;
    radio.addEventListener("change", () => {
      pref = radio.value as ThemePref;
      saveThemePref(pref);
      applyTheme(pref);
    });
  });
}

function initInstall() {
  const row = document.querySelector<HTMLElement>("#installRow");
  const button = document.querySelector<HTMLButtonElement>("#installButton");
  const hint = document.querySelector<HTMLElement>("#installHint");
  if (!row || !button || !hint) return;

  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return;

  let deferred: BeforeInstallPromptEvent | null = null;
  // iPhone and iPad never fire beforeinstallprompt; installing is a manual step in Safari's Share menu.
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
    row.hidden = false;
    button.hidden = true;
    hint.textContent = "In Safari, tap Share, then Add to Home Screen.";
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    row.hidden = false;
    button.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    row.hidden = true;
  });
  button.addEventListener("click", async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === "accepted") row.hidden = true;
  });
}

function registerServiceWorker() {
  // Dev builds change constantly, so only the built app is cached for offline use.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () => navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Service worker failed", error));
  // The app starts after async storage reads, so "load" has usually fired already.
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
}

export function initDevice() {
  initTheme();
  initInstall();
  registerServiceWorker();
}
