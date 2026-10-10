/**
 * 历史明文凭证残留清理测试
 *
 * 覆盖：检测含 refresh_token 的文件、清理精确目录、符号链接拒绝、
 * 路径越界拒绝、第三方工具目录只报告不删除。
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    getLegacyCockpitDir,
    purgeLegacyResidue,
    scanLegacyResidue,
} from './legacy_cleanup';

jest.mock('os', () => ({
    ...jest.requireActual('os'),
    homedir: jest.fn(),
}));

const homedirMock = os.homedir as unknown as jest.Mock;

describe('legacy_cleanup', () => {
    let homeDir: string;

    beforeEach(async () => {
        homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-legacy-'));
        homedirMock.mockReturnValue(homeDir);
    });

    afterEach(async () => {
        await fs.rm(homeDir, { recursive: true, force: true });
    });

    async function writeLegacyCredential(): Promise<string> {
        const dir = getLegacyCockpitDir();
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(dir, 'credentials.json');
        await fs.writeFile(file, JSON.stringify({
            email: 'alice@example.com',
            refresh_token: 'super-secret-token',
            access_token: 'another-secret',
        }));
        return file;
    }

    it('reports no residue when nothing exists', async () => {
        const report = await scanLegacyResidue();
        expect(report.dirExists).toBe(false);
        expect(report.sensitiveFiles).toEqual([]);
    });

    it('detects files containing refresh tokens', async () => {
        const file = await writeLegacyCredential();
        const report = await scanLegacyResidue();

        expect(report.dirExists).toBe(true);
        expect(report.dirIsSymlink).toBe(false);
        expect(report.sensitiveFiles).toContain(file);
    });

    it('ignores innocuous cache files', async () => {
        const dir = getLegacyCockpitDir();
        await fs.mkdir(path.join(dir, 'cache', 'quota_v2'), { recursive: true });
        await fs.writeFile(path.join(dir, 'cache', 'quota_v2', 'abc.json'), JSON.stringify({
            models: [{ label: 'Gemini' }],
        }));
        await fs.writeFile(path.join(dir, 'sync_settings.json'), JSON.stringify({ language: 'en' }));

        const report = await scanLegacyResidue();
        expect(report.sensitiveFiles).toEqual([]);
    });

    it('purges the exact legacy directory', async () => {
        await writeLegacyCredential();
        const report = await scanLegacyResidue();

        const removed = await purgeLegacyResidue(report);
        expect(removed).toBe(1);
        await expect(fs.lstat(getLegacyCockpitDir())).rejects.toThrow();
    });

    it('refuses to purge an unexpected path', async () => {
        const report = await scanLegacyResidue();
        await expect(purgeLegacyResidue({ ...report, dir: path.join(homeDir, 'somewhere-else') }))
            .rejects.toThrow(/unexpected path/i);
    });

    it('refuses to purge a symlinked legacy directory', async () => {
        const realDir = path.join(homeDir, 'real-store');
        await fs.mkdir(realDir, { recursive: true });
        const linkDir = getLegacyCockpitDir();
        try {
            await fs.symlink(realDir, linkDir, 'dir');
        } catch {
            // Windows 无开发者模式时可能无权限创建符号链接，跳过
            return;
        }

        const report = await scanLegacyResidue();
        expect(report.dirIsSymlink).toBe(true);
        await expect(purgeLegacyResidue(report)).rejects.toThrow(/symlink/i);
    });

    it('reports the third-party tools directory without deleting it', async () => {
        const otherTool = path.join(homeDir, '.antigravity_tools');
        await fs.mkdir(otherTool, { recursive: true });
        await fs.writeFile(path.join(otherTool, 'accounts.json'), JSON.stringify({ accounts: [] }));
        await writeLegacyCredential();

        const report = await scanLegacyResidue();
        expect(report.otherToolDir).toBe(otherTool);

        await purgeLegacyResidue(report);
        await expect(fs.lstat(otherTool)).resolves.toBeTruthy();
    });
});
