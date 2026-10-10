/**
 * antigravityQuota - 国际化
 *
 * 保留完整多语言支持（16 种语言），但翻译键集只覆盖精简版 UI。
 * 运行时资源全部静态内联，不加载任何外部翻译文件。
 */

import * as vscode from 'vscode';
import {
    ar,
    cs,
    de,
    en,
    es,
    fr,
    it,
    ja,
    ko,
    pl,
    ptBR,
    ru,
    tr,
    vi,
    zhCN,
    zhTW,
    type TranslationMap,
} from './translations';

export type SupportedLocale =
    | 'en'
    | 'zh-cn'
    | 'zh-tw'
    | 'ja'
    | 'ko'
    | 'de'
    | 'fr'
    | 'es'
    | 'pt-br'
    | 'ru'
    | 'it'
    | 'tr'
    | 'pl'
    | 'cs'
    | 'ar'
    | 'vi';

/** 语言显示名称（用于设置项枚举描述） */
export const localeDisplayNames: Record<SupportedLocale, string> = {
    'en': 'English',
    'zh-cn': '简体中文',
    'zh-tw': '繁體中文',
    'ja': '日本語',
    'ko': '한국어',
    'de': 'Deutsch',
    'fr': 'Français',
    'es': 'Español',
    'pt-br': 'Português (Brasil)',
    'ru': 'Русский',
    'it': 'Italiano',
    'tr': 'Türkçe',
    'pl': 'Polski',
    'cs': 'Čeština',
    'ar': 'العربية',
    'vi': 'Tiếng Việt',
};

const translations: Record<SupportedLocale, TranslationMap> = {
    'en': en,
    'zh-cn': zhCN,
    'zh-tw': zhTW,
    'ja': ja,
    'ko': ko,
    'de': de,
    'fr': fr,
    'es': es,
    'pt-br': ptBR,
    'ru': ru,
    'it': it,
    'tr': tr,
    'pl': pl,
    'cs': cs,
    'ar': ar,
    'vi': vi,
};

/** VS Code 语言代码 → 本扩展语言代码 */
const localeMapping: Record<string, SupportedLocale> = {
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    'zh': 'zh-cn',
    'zh-cn': 'zh-cn',
    'zh-hans': 'zh-cn',
    'zh-tw': 'zh-tw',
    'zh-hant': 'zh-tw',
    'ja': 'ja',
    'ko': 'ko',
    'de': 'de',
    'fr': 'fr',
    'es': 'es',
    'pt': 'pt-br',
    'pt-br': 'pt-br',
    'ru': 'ru',
    'it': 'it',
    'tr': 'tr',
    'pl': 'pl',
    'cs': 'cs',
    'ar': 'ar',
    'vi': 'vi',
    'vi-vn': 'vi',
};

const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set(['ar']);

/** 规范化外部传入的语言值：'auto' | 受支持语言代码 */
export function normalizeLocaleInput(languageSetting: string): string {
    const trimmed = (languageSetting || '').trim().toLowerCase();
    if (!trimmed) {
        return 'auto';
    }
    if (trimmed === 'auto') {
        return 'auto';
    }
    if (localeMapping[trimmed]) {
        return localeMapping[trimmed];
    }
    const prefix = trimmed.split('-')[0];
    if (localeMapping[prefix]) {
        return localeMapping[prefix];
    }
    return 'auto';
}

class I18nService {
    private currentLocale: SupportedLocale = 'en';

    constructor() {
        this.detectLocale();
    }

    private detectLocale(): void {
        this.currentLocale = resolveLocaleFromHost(vscode.env.language);
    }

    /** 应用语言设置（'auto' 跟随 VS Code） */
    applyLanguageSetting(languageSetting: string): boolean {
        const previous = this.currentLocale;
        const normalized = normalizeLocaleInput(languageSetting);
        if (normalized === 'auto') {
            this.detectLocale();
        } else {
            this.currentLocale = normalized as SupportedLocale;
        }
        return this.currentLocale !== previous;
    }

    getLocale(): SupportedLocale {
        return this.currentLocale;
    }

    isRtl(): boolean {
        return RTL_LOCALES.has(this.currentLocale);
    }

    t(key: string, params?: Record<string, string | number>): string {
        const translation = translations[this.currentLocale]?.[key] ?? translations.en[key] ?? key;
        if (!params) {
            return translation;
        }
        return Object.entries(params).reduce(
            (text, [paramKey, paramValue]) => text.split(`{${paramKey}}`).join(String(paramValue)),
            translation,
        );
    }

    /** 当前语言的全部翻译（供 Webview 使用） */
    getAllTranslations(): TranslationMap {
        return { ...en, ...translations[this.currentLocale] };
    }

    getSupportedLocales(): SupportedLocale[] {
        return Object.keys(translations) as SupportedLocale[];
    }

    getLocaleDisplayName(locale: SupportedLocale): string {
        return localeDisplayNames[locale] ?? locale;
    }
}

function resolveLocaleFromHost(language: string | undefined): SupportedLocale {
    const raw = (language || 'en').toLowerCase();
    if (localeMapping[raw]) {
        return localeMapping[raw];
    }
    const prefix = raw.split('-')[0];
    if (localeMapping[prefix]) {
        return localeMapping[prefix];
    }
    return 'en';
}

export const i18n = new I18nService();

export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
