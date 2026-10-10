/**
 * env_guard 安全回归测试
 *
 * 覆盖：回环地址白名单、端口校验、CSRF token 格式、刷新间隔硬下限、
 * 抖动范围、Markdown/HTML 转义。
 */

import {
    clampNumber,
    clampRefreshIntervalMs,
    escapeHtml,
    escapeMarkdown,
    isLoopbackHost,
    isValidCsrfToken,
    isValidPort,
    withJitter,
} from './env_guard';
import { TIMING } from './constants';

describe('env_guard', () => {
    describe('isLoopbackHost', () => {
        it('accepts only loopback hosts', () => {
            expect(isLoopbackHost('127.0.0.1')).toBe(true);
            expect(isLoopbackHost('localhost')).toBe(true);
            expect(isLoopbackHost('::1')).toBe(true);
            expect(isLoopbackHost(' 127.0.0.1 ')).toBe(true);
        });

        it('rejects everything else (no external egress, no DNS names)', () => {
            expect(isLoopbackHost('evil.example.com')).toBe(false);
            expect(isLoopbackHost('0.0.0.0')).toBe(false);
            expect(isLoopbackHost('192.168.1.10')).toBe(false);
            expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
            expect(isLoopbackHost('')).toBe(false);
            expect(isLoopbackHost(null)).toBe(false);
            expect(isLoopbackHost(undefined)).toBe(false);
        });
    });

    describe('isValidPort', () => {
        it('accepts valid TCP ports only', () => {
            expect(isValidPort(1)).toBe(true);
            expect(isValidPort(11451)).toBe(true);
            expect(isValidPort(65535)).toBe(true);
        });

        it('rejects invalid or hostile values', () => {
            expect(isValidPort(0)).toBe(false);
            expect(isValidPort(-1)).toBe(false);
            expect(isValidPort(65536)).toBe(false);
            expect(isValidPort(1.5)).toBe(false);
            expect(isValidPort(Number.NaN)).toBe(false);
            expect(isValidPort('11451')).toBe(false);
            expect(isValidPort('11451; rm -rf /')).toBe(false);
        });
    });

    describe('isValidCsrfToken', () => {
        it('accepts hex-ish tokens', () => {
            expect(isValidCsrfToken('abc-123_DEF')).toBe(true);
        });

        it('rejects anything that could be an injection payload', () => {
            expect(isValidCsrfToken('')).toBe(false);
            expect(isValidCsrfToken('a b')).toBe(false);
            expect(isValidCsrfToken('a"b')).toBe(false);
            expect(isValidCsrfToken('a;b')).toBe(false);
            expect(isValidCsrfToken('a$(whoami)')).toBe(false);
            expect(isValidCsrfToken('x'.repeat(257))).toBe(false);
            expect(isValidCsrfToken(undefined)).toBe(false);
        });
    });

    describe('clampRefreshIntervalMs', () => {
        it('enforces the 60s hard floor (rate-limit protection)', () => {
            expect(clampRefreshIntervalMs(1_000)).toBe(TIMING.MIN_REFRESH_INTERVAL_MS);
            expect(clampRefreshIntervalMs(10_000)).toBe(TIMING.MIN_REFRESH_INTERVAL_MS);
            expect(clampRefreshIntervalMs(60_000)).toBe(60_000);
        });

        it('enforces the 1h ceiling and falls back on garbage', () => {
            expect(clampRefreshIntervalMs(99 * 60 * 60 * 1000)).toBe(TIMING.MAX_REFRESH_INTERVAL_MS);
            expect(clampRefreshIntervalMs(Number.NaN)).toBe(TIMING.DEFAULT_REFRESH_INTERVAL_MS);
            expect(clampRefreshIntervalMs(undefined)).toBe(TIMING.DEFAULT_REFRESH_INTERVAL_MS);
            expect(clampRefreshIntervalMs('x')).toBe(TIMING.DEFAULT_REFRESH_INTERVAL_MS);
        });
    });

    describe('clampNumber', () => {
        it('clamps and falls back', () => {
            expect(clampNumber(5, 1, 10, 3)).toBe(5);
            expect(clampNumber(0, 1, 10, 3)).toBe(1);
            expect(clampNumber(50, 1, 10, 3)).toBe(10);
            expect(clampNumber('nope', 1, 10, 3)).toBe(3);
            expect(clampNumber(Infinity, 1, 10, 3)).toBe(3);
        });
    });

    describe('withJitter', () => {
        it('stays within ±10% of the base for every sample', () => {
            const base = 60_000;
            for (let i = 0; i < 200; i++) {
                const value = withJitter(base);
                expect(value).toBeGreaterThanOrEqual(Math.floor(base * 0.9));
                expect(value).toBeLessThanOrEqual(Math.ceil(base * 1.1));
            }
        });

        it('passes through invalid bases', () => {
            expect(withJitter(0)).toBe(0);
            expect(withJitter(-5)).toBe(-5);
        });
    });

    describe('escaping', () => {
        it('neutralises markdown table/link syntax', () => {
            const escaped = escapeMarkdown('a|b*[c](d)`e`');
            expect(escaped.includes('\\|')).toBe(true);
            expect(escaped.includes('](')).toBe(false);
            expect(escaped.includes('*[c]')).toBe(false);
        });

        it('neutralises HTML', () => {
            expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
                '&lt;img src=x onerror=alert(1)&gt;',
            );
        });
    });
});
