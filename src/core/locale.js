let locale = null;

export async function loadLocale(lang = 'fr') {
  const url = new URL(`../../locales/${lang}.json`, import.meta.url);
  const response = await fetch(url);
  locale = await response.json();
  return locale;
}

export function t(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], locale) ?? key;
}
