let locale = null;

export async function loadLocale(lang = 'fr') {
  const modules = {
    fr: () => import('../../locales/fr.js'),
    en: () => import('../../locales/en.js'),
  };
  const loader = modules[lang];
  if (!loader) throw new Error(`Locale '${lang}' not found`);
  const module = await loader();
  locale = module.default;
  return locale;
}

export function t(key) {
  return key.split('.').reduce((obj, k) => obj?.[k], locale) ?? key;
}
