/**
 * 安全不变量回归测试（源码级静态断言）
 *
 * 这些断言把 docs/隐患.md 的处置结论「钉死」在代码库里：
 * 一旦有人重新引入 OAuth / 外部外联 / 明文凭证 / 宽松 CSP，
 * 测试会立即失败。
 */

import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { buildDashboardCsp } from '../view/dashboard';

const SRC_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(SRC_DIR, '..');

function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectSourceFiles(full));
            continue;
        }
        if (!/\.(ts|js)$/.test(entry.name) || entry.name.endsWith('.test.ts')) {
            continue;
        }
        out.push(full);
    }
    return out;
}

const sourceFiles = collectSourceFiles(SRC_DIR);

function read(file: string): string {
    return readFileSync(file, 'utf8');
}

describe('安全不变量', () => {
    it('源码中不存在任何外部网络主机', () => {
        const forbidden = ['googleapis.com', 'accounts.google.com', 'githubusercontent.com', 'github.com'];
        for (const file of sourceFiles) {
            const content = read(file);
            for (const host of forbidden) {
                expect({ file: path.relative(PROJECT_DIR, file), host, found: content.includes(host) })
                    .toEqual({ file: path.relative(PROJECT_DIR, file), host, found: false });
            }
        }
    });

    it('源码中不存在 OAuth / cloud-platform 相关常量', () => {
        const forbidden = [
            'ANTIGRAVITY_CLIENT_ID',
            'ANTIGRAVITY_CLIENT_SECRET',
            'cloud-platform',
            'oauth2.googleapis.com',
            'userinfo.email',
        ];
        for (const file of sourceFiles) {
            const content = read(file);
            for (const token of forbidden) {
                expect({ file: path.relative(PROJECT_DIR, file), token, found: content.includes(token) })
                    .toEqual({ file: path.relative(PROJECT_DIR, file), token, found: false });
            }
        }
    });

    it('源码中不存在明文凭证常量赋值', () => {
        const assignment = /client_secret['"]?\s*[:=]\s*['"]/i;
        for (const file of sourceFiles) {
            expect({ file: path.relative(PROJECT_DIR, file), found: assignment.test(read(file)) })
                .toEqual({ file: path.relative(PROJECT_DIR, file), found: false });
        }
    });

    it('不引入 sql.js / cron-parser 等旁支依赖', () => {
        const pkg = JSON.parse(read(path.join(PROJECT_DIR, 'package.json'))) as {
            dependencies?: Record<string, string>;
        };
        expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    });

    it('package.json 不再暴露已删除的功能配置项', () => {
        const pkg = read(path.join(PROJECT_DIR, 'package.json'));
        for (const key of ['quotaSource', 'groupingEnabled', 'autoTrigger', 'profileHidden', 'displayMode']) {
            expect({ key, found: pkg.includes(key) }).toEqual({ key, found: false });
        }
    });

    it('Webview CSP 不含 unsafe-inline / unsafe-eval，且脚本走 nonce', () => {
        const csp = buildDashboardCsp('vscode-webview://mock', 'NONCE123');

        expect(csp).not.toContain('unsafe-inline');
        expect(csp).not.toContain('unsafe-eval');
        expect(csp).toContain("script-src 'nonce-NONCE123'");
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("connect-src 'none'");
        expect(csp).toContain('img-src vscode-webview://mock data:');

        for (const file of sourceFiles) {
            const content = read(file);
            expect({ file: path.relative(PROJECT_DIR, file), found: content.includes('unsafe-inline') })
                .toEqual({ file: path.relative(PROJECT_DIR, file), found: false });
            expect({ file: path.relative(PROJECT_DIR, file), found: content.includes('unsafe-eval') })
                .toEqual({ file: path.relative(PROJECT_DIR, file), found: false });
        }
    });

    it('Webview CSP 不允许任何远程来源（含图片）', () => {
        const csp = buildDashboardCsp('vscode-webview://mock', 'NONCE123');

        expect(csp).not.toMatch(/https?:/i);
        expect(csp).not.toContain('*');
    });

    it('Webview 脚本不使用 innerHTML / eval / new Function', () => {
        const webviewDir = path.join(SRC_DIR, 'view', 'webview');
        const forbidden = ['innerHTML', 'outerHTML', 'eval(', 'new Function', 'document.write'];
        for (const entry of readdirSync(webviewDir)) {
            if (!entry.endsWith('.js')) {
                continue;
            }
            const content = read(path.join(webviewDir, entry));
            for (const token of forbidden) {
                expect({ file: entry, token, found: content.includes(token) })
                    .toEqual({ file: entry, token, found: false });
            }
        }
    });

    it('只用 legacy_cleanup 触碰用户主目录，且仅做清理', () => {
        const homedirUsers = sourceFiles
            .filter(file => read(file).includes('homedir('))
            .map(file => path.relative(SRC_DIR, file).replace(/\\/g, '/'))
            .sort();

        expect(homedirUsers).toEqual(['shared/legacy_cleanup.ts']);
    });

    it('源码中不存在向用户主目录写入凭证的调用', () => {
        const credentialWrite = /(refreshToken|refresh_token|accessToken|access_token)['"]?\s*[:,]\s*(credential|token)/i;
        for (const file of sourceFiles) {
            expect({ file: path.relative(PROJECT_DIR, file), found: credentialWrite.test(read(file)) })
                .toEqual({ file: path.relative(PROJECT_DIR, file), found: false });
        }
    });

    it('扩展不再注册自动唤醒 / 多账号切换命令', () => {
        const pkg = read(path.join(PROJECT_DIR, 'package.json'));
        for (const command of ['autoTrigger', 'accountTree', 'switchAccount', 'refreshAnnouncements']) {
            expect({ command, found: pkg.includes(command) }).toEqual({ command, found: false });
        }
    });
});
