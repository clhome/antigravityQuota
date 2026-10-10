/**
 * antigravityQuota - 环境与输入守卫
 *
 * 集中所有「外部输入 → 危险操作」的校验，避免各处各写一份。
 * 设计原则：只做允许（allowlist），不做黑名单。
 */

import { TIMING } from './constants';

/** 允许的回环主机名（本地 language server 只应通过这些地址访问） */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

/** 是否为允许的回环主机 */
export function isLoopbackHost(host: string | undefined | null): boolean {
    if (!host) {
        return false;
    }
    return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/** TCP 端口是否合法（1-65535 的整数） */
export function isValidPort(port: unknown): port is number {
    return typeof port === 'number'
        && Number.isInteger(port)
        && port > 0
        && port <= 65535;
}

/** 校验端口，非法时抛错 */
export function assertValidPort(port: unknown): number {
    if (!isValidPort(port)) {
        throw new Error(`Invalid port: ${String(port)}`);
    }
    return port;
}

/**
 * CSRF Token 是否形如本地 language server 生成的 token。
 * 只允许十六进制与连字符，长度受限，避免被用作注入载荷。
 */
export function isValidCsrfToken(token: unknown): token is string {
    return typeof token === 'string'
        && token.length > 0
        && token.length <= 256
        && /^[a-zA-Z0-9_-]+$/.test(token);
}

/** 数值夹取：非法值或越界时回退 */
export function clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
): number {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, num));
}

/**
 * 刷新间隔夹取：硬下限 60s，防止高频轮询非公开接口。
 */
export function clampRefreshIntervalMs(value: unknown): number {
    return clampNumber(
        value,
        TIMING.MIN_REFRESH_INTERVAL_MS,
        TIMING.MAX_REFRESH_INTERVAL_MS,
        TIMING.DEFAULT_REFRESH_INTERVAL_MS,
    );
}

/** 在基准值上叠加 ±ratio 的随机抖动（用于错峰轮询） */
export function withJitter(baseMs: number, ratio: number = TIMING.JITTER_RATIO): number {
    if (!Number.isFinite(baseMs) || baseMs <= 0) {
        return baseMs;
    }
    const safeRatio = clampNumber(ratio, 0, 0.5, TIMING.JITTER_RATIO);
    const delta = baseMs * safeRatio;
    return Math.round(baseMs - delta + Math.random() * delta * 2);
}

/** 转义 Markdown 表格/强调字符，避免服务端文本破坏渲染或注入链接 */
export function escapeMarkdown(text: string): string {
    return String(text).replace(/[\\`*_{}[\]()#+\-.!|<>]/g, ch => `\\${ch}`);
}

/** HTML 文本转义（用于 webview 之外拼接字符串时兜底） */
export function escapeHtml(text: string): string {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
