/**
 * i18n 多语言完整性回归测试
 *
 * 保证 16 种语言的键集合与占位符完全一致 —— 避免新增 key 后某些语言出现
 * 「显示成 key 原文」或占位符丢失。
 */

import { en } from './translations/en';
import { zhCN } from './translations/zh-cn';
import { zhTW } from './translations/zh-tw';
import { ja } from './translations/ja';
import { ko } from './translations/ko';
import { de } from './translations/de';
import { fr } from './translations/fr';
import { es } from './translations/es';
import { ptBR } from './translations/pt-br';
import { ru } from './translations/ru';
import { it as itLocale } from './translations/it';
import { tr } from './translations/tr';
import { pl } from './translations/pl';
import { cs } from './translations/cs';
import { ar } from './translations/ar';
import { vi } from './translations/vi';
import type { TranslationMap } from './translations/types';
import { i18n, normalizeLocaleInput, localeDisplayNames } from './i18n';

const LOCALES: Array<[string, TranslationMap]> = [
    ['en', en],
    ['zh-cn', zhCN],
    ['zh-tw', zhTW],
    ['ja', ja],
    ['ko', ko],
    ['de', de],
    ['fr', fr],
    ['es', es],
    ['pt-br', ptBR],
    ['ru', ru],
    ['it', itLocale],
    ['tr', tr],
    ['pl', pl],
    ['cs', cs],
    ['ar', ar],
    ['vi', vi],
];

const placeholders = (value: string): string[] =>
    (value.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();

describe('i18n 多语言', () => {
    const referenceKeys = Object.keys(en).sort();

    it('覆盖 16 种语言', () => {
        expect(LOCALES).toHaveLength(16);
        expect(i18n.getSupportedLocales()).toHaveLength(16);
    });

    it('每种语言的键集合与 en 完全一致', () => {
        for (const [locale, map] of LOCALES) {
            expect({ locale, keys: Object.keys(map).sort() }).toEqual({
                locale,
                keys: referenceKeys,
            });
        }
    });

    it('每种语言都没有空译文', () => {
        for (const [locale, map] of LOCALES) {
            for (const key of referenceKeys) {
                expect({ locale, key, empty: map[key].trim().length === 0 }).toEqual({
                    locale,
                    key,
                    empty: false,
                });
            }
        }
    });

    it('每种语言的占位符与 en 完全一致', () => {
        for (const [locale, map] of LOCALES) {
            for (const key of referenceKeys) {
                expect({ locale, key, ph: placeholders(map[key]) }).toEqual({
                    locale,
                    key,
                    ph: placeholders(en[key]),
                });
            }
        }
    });

    it('所有语言都有显示名称', () => {
        for (const [locale] of LOCALES) {
            expect(localeDisplayNames[locale as keyof typeof localeDisplayNames]).toBeTruthy();
        }
    });
});

describe('normalizeLocaleInput', () => {
    it('maps host locale variants', () => {
        expect(normalizeLocaleInput('zh-cn')).toBe('zh-cn');
        expect(normalizeLocaleInput('zh-Hans')).toBe('zh-cn');
        expect(normalizeLocaleInput('zh-TW')).toBe('zh-tw');
        expect(normalizeLocaleInput('en-US')).toBe('en');
        expect(normalizeLocaleInput('pt-br')).toBe('pt-br');
        expect(normalizeLocaleInput('de')).toBe('de');
    });

    it('keeps auto and falls back to auto for unknown values', () => {
        expect(normalizeLocaleInput('auto')).toBe('auto');
        expect(normalizeLocaleInput('')).toBe('auto');
        expect(normalizeLocaleInput('klingon')).toBe('auto');
    });
});

describe('I18nService', () => {
    afterEach(() => {
        i18n.applyLanguageSetting('en');
    });

    it('switches locale and reports change', () => {
        const changed = i18n.applyLanguageSetting('zh-cn');
        expect(changed).toBe(true);
        expect(i18n.getLocale()).toBe('zh-cn');
        expect(i18n.t('dashboard.title')).toBe(zhCN['dashboard.title']);
        expect(i18n.applyLanguageSetting('zh-cn')).toBe(false);
    });

    it('marks arabic as RTL', () => {
        i18n.applyLanguageSetting('ar');
        expect(i18n.isRtl()).toBe(true);
        i18n.applyLanguageSetting('en');
        expect(i18n.isRtl()).toBe(false);
    });

    it('interpolates parameters without regex injection', () => {
        i18n.applyLanguageSetting('en');
        expect(i18n.t('notify.warning', { model: 'Gemini', percent: 12 })).toContain('Gemini');
        expect(i18n.t('notify.warning', { model: 'Gemini', percent: 12 })).toContain('12');
    });

    it('falls back to the key itself for unknown keys', () => {
        i18n.applyLanguageSetting('en');
        expect(i18n.t('nope.nope')).toBe('nope.nope');
    });
});
