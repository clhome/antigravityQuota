/**
 * antigravityQuota - 历史明文凭证残留清理
 *
 * 背景（见 docs/隐患.md 一.1、三.2）：旧版本 / 配套桌面工具可能把
 * Google OAuth 的 access/refresh token 以明文 JSON 写入
 *   ~/.antigravity_cockpit/…
 * 当前版本不再产生任何此类文件，但历史残留仍需清理。
 *
 * 安全约束：
 *  - 只允许操作 `os.homedir()/.antigravity_cockpit` 这一个精确目录；
 *  - 目录若为符号链接则拒绝处理（防目录穿越 / 诱导删除）；
 *  - 遍历有深度与条目上限，且不跟随符号链接；
 *  - `~/.antigravity_tools` 属于第三方工具，只报告、绝不删除。
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './log_service';

const LEGACY_DIR_NAME = '.antigravity_cockpit';
const OTHER_TOOL_DIR_NAME = '.antigravity_tools';

const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_ENTRIES = 2000;
const MAX_INSPECT_BYTES = 256 * 1024;

/** 文件名层面的敏感特征 */
const SENSITIVE_NAME_PATTERN = /(credential|account|token|secret|oauth|auth)/i;
/** 内容层面的敏感特征（键名 + JSON 结构） */
const SENSITIVE_CONTENT_PATTERN = /"(refresh_token|refreshToken|access_token|accessToken|client_secret|clientSecret)"\s*:/;

export interface LegacyResidueReport {
    /** 可能的残留目录 */
    dir: string;
    /** 目录是否存在 */
    dirExists: boolean;
    /** 目录是否为符号链接（为真时拒绝清理） */
    dirIsSymlink: boolean;
    /** 判定为含凭证的文件（绝对路径） */
    sensitiveFiles: string[];
    /** 第三方工具目录（存在时仅提示，不清理） */
    otherToolDir: string | null;
}

export function getLegacyCockpitDir(): string {
    return path.join(os.homedir(), LEGACY_DIR_NAME);
}

export function getOtherToolDir(): string {
    return path.join(os.homedir(), OTHER_TOOL_DIR_NAME);
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.lstat(target);
        return true;
    } catch {
        return false;
    }
}

async function looksLikeCredentialFile(filePath: string): Promise<boolean> {
    const base = path.basename(filePath);
    if (base.endsWith('.json') && SENSITIVE_NAME_PATTERN.test(base)) {
        return true;
    }
    try {
        const handle = await fs.open(filePath, 'r');
        try {
            const buffer = Buffer.alloc(MAX_INSPECT_BYTES);
            const { bytesRead } = await handle.read(buffer, 0, MAX_INSPECT_BYTES, 0);
            return SENSITIVE_CONTENT_PATTERN.test(buffer.subarray(0, bytesRead).toString('utf8'));
        } finally {
            await handle.close();
        }
    } catch {
        return false;
    }
}

async function walk(
    dir: string,
    depth: number,
    budget: { remaining: number },
    out: string[],
): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || budget.remaining <= 0) {
        return;
    }

    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (budget.remaining-- <= 0) {
            return;
        }
        const full = path.join(dir, entry.name);
        // 不跟随符号链接，避免穿越到主目录之外
        if (entry.isSymbolicLink()) {
            continue;
        }
        if (entry.isDirectory()) {
            await walk(full, depth + 1, budget, out);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        // 跳过明显无关的大缓存文件，减少 IO
        if (entry.name.startsWith('quota_v2') || entry.name.startsWith('quota_history')) {
            continue;
        }
        if (await looksLikeCredentialFile(full)) {
            out.push(full);
        }
    }
}

/** 扫描历史明文凭证残留（只读，不做任何删除） */
export async function scanLegacyResidue(): Promise<LegacyResidueReport> {
    const dir = getLegacyCockpitDir();
    const report: LegacyResidueReport = {
        dir,
        dirExists: false,
        dirIsSymlink: false,
        sensitiveFiles: [],
        otherToolDir: null,
    };

    try {
        const stat = await fs.lstat(dir);
        if (stat.isSymbolicLink()) {
            report.dirExists = true;
            report.dirIsSymlink = true;
            logger.warn(`[LegacyCleanup] ${dir} is a symlink; refusing to inspect or delete`);
            return report;
        }
        if (!stat.isDirectory()) {
            return report;
        }
        report.dirExists = true;
    } catch {
        // 目录不存在：无需清理
        return report;
    }

    const found: string[] = [];
    await walk(dir, 0, { remaining: MAX_SCAN_ENTRIES }, found);
    report.sensitiveFiles = found;

    if (await pathExists(getOtherToolDir())) {
        report.otherToolDir = getOtherToolDir();
    }

    return report;
}

/**
 * 删除历史残留目录。
 * 只允许删除 `os.homedir()/.antigravity_cockpit`（非符号链接），返回删除的文件数。
 */
export async function purgeLegacyResidue(report: LegacyResidueReport): Promise<number> {
    const expected = getLegacyCockpitDir();
    if (path.resolve(report.dir) !== path.resolve(expected)) {
        throw new Error(`Refusing to delete unexpected path: ${report.dir}`);
    }
    if (report.dirIsSymlink) {
        throw new Error('Refusing to delete a symlinked directory');
    }
    if (!report.dirExists) {
        return 0;
    }

    const stat = await fs.lstat(expected);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Refusing to delete: target is not a regular directory');
    }

    await fs.rm(expected, { recursive: true, force: true });
    const removed = report.sensitiveFiles.length;
    logger.warn(`[LegacyCleanup] Removed legacy directory ${expected} (${removed} credential-like file(s))`);
    return removed;
}
