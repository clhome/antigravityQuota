/**
 * antigravityQuota - 平台策略
 *
 * 针对不同操作系统的进程检测策略。
 * 加固点：
 *  - 进程名只允许来自 PROCESS_NAMES 白名单，杜绝把外部字符串拼进命令；
 *  - PID / 端口在拼入命令前一律做数值校验；
 *  - 解析结果做长度与格式约束。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../shared/log_service';
import { ALLOWED_PROCESS_NAMES } from '../shared/constants';
import { assertValidPort } from '../shared/env_guard';
import { PlatformStrategy, ProcessInfo } from '../shared/types';

const execAsync = promisify(exec);

const MAX_PARSE_INPUT_LENGTH = 4 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 256;

/** 校验进程名来自白名单 */
function assertAllowedProcessName(processName: string): string {
    if (!ALLOWED_PROCESS_NAMES.has(processName)) {
        throw new Error(`Refusing to build command for unknown process name: ${processName}`);
    }
    return processName;
}

/** 校验 PID 为正整数 */
function assertValidPid(pid: number): number {
    if (!Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) {
        throw new Error(`Invalid pid: ${String(pid)}`);
    }
    return pid;
}

/** 校验 CSRF token 字符集与长度 */
function sanitizeToken(token: string | undefined): string | null {
    if (!token) {
        return null;
    }
    const trimmed = token.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) {
        return null;
    }
    return /^[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Windows 平台策略
 */
export class WindowsStrategy implements PlatformStrategy {
    /**
     * 判断命令行是否属于 Antigravity 进程。
     * 必须同时满足：--extension_server_port、--csrf_token、--app_data_dir antigravity。
     */
    private isAntigravityProcess(commandLine: string): boolean {
        if (!commandLine.includes('--extension_server_port')) {
            return false;
        }
        if (!commandLine.includes('--csrf_token')) {
            return false;
        }
        return /--app_data_dir\s+antigravity\b/i.test(commandLine);
    }

    getProcessListCommand(processName: string): string {
        assertAllowedProcessName(processName);
        const utf8Header = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
        const escaped = processName.replace(/'/g, "''");
        return `chcp 65001 >nul && powershell -NoProfile -NonInteractive -Command "${utf8Header}Get-CimInstance Win32_Process -Filter 'name=''${escaped}''' | Select-Object ProcessId,CommandLine | ConvertTo-Json"`;
    }

    /** 备用方案：查找所有包含 csrf_token 的进程 */
    getProcessByKeywordCommand(): string {
        const utf8Header = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
        return `chcp 65001 >nul && powershell -NoProfile -NonInteractive -Command "${utf8Header}Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'csrf_token' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json"`;
    }

    parseProcessInfo(stdout: string): ProcessInfo[] {
        logger.debug('[WindowsStrategy] Parsing JSON process info...');

        if (!stdout || stdout.length > MAX_PARSE_INPUT_LENGTH) {
            logger.warn('[WindowsStrategy] Empty or oversized process output, skipping');
            return [];
        }

        try {
            // 清理可能存在的非 JSON 杂质
            const jsonStart = stdout.indexOf('[');
            const jsonObjectStart = stdout.indexOf('{');
            let cleanStdout = stdout;

            if (jsonStart >= 0 || jsonObjectStart >= 0) {
                const start = (jsonStart >= 0 && jsonObjectStart >= 0)
                    ? Math.min(jsonStart, jsonObjectStart)
                    : Math.max(jsonStart, jsonObjectStart);
                cleanStdout = stdout.substring(start);
            }

            let data: unknown = JSON.parse(cleanStdout.trim());
            if (!Array.isArray(data)) {
                data = [data];
            }

            const candidates: ProcessInfo[] = [];
            for (const item of data as Array<Record<string, unknown>>) {
                const commandLine = typeof item?.CommandLine === 'string' ? item.CommandLine : '';
                if (!commandLine || !this.isAntigravityProcess(commandLine)) {
                    continue;
                }

                const pid = Number(item?.ProcessId);
                if (!Number.isInteger(pid) || pid <= 0) {
                    continue;
                }

                const portMatch = commandLine.match(/--extension_server_port[=\s]+(\d+)/);
                const tokenMatch = commandLine.match(/--csrf_token[=\s]+([a-f0-9-]+)/i);
                const csrfToken = sanitizeToken(tokenMatch?.[1]);
                if (!csrfToken) {
                    logger.warn(`[WindowsStrategy] Cannot extract CSRF Token from PID ${pid}`);
                    continue;
                }

                const rawPort = portMatch?.[1] ? parseInt(portMatch[1], 10) : 0;
                const extensionPort = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 0;

                candidates.push({ pid, extensionPort, csrfToken });
            }

            logger.info(`[WindowsStrategy] Found ${candidates.length} Antigravity candidate process(es)`);
            return candidates;
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            const stdoutPreview = stdout.length > 200 ? `${stdout.substring(0, 200)}...` : stdout;
            logger.debug(`[WindowsStrategy] JSON parse failed: ${error.message}. Output preview: ${stdoutPreview}`);
            return [];
        }
    }

    getPortListCommand(pid: number): string {
        assertValidPid(pid);
        const utf8Header = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
        return `chcp 65001 >nul && powershell -NoProfile -NonInteractive -Command "${utf8Header}$ports = Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort; if ($ports) { $ports | Sort-Object -Unique }"`;
    }

    parseListeningPorts(stdout: string): number[] {
        const ports = new Set<number>();
        const matches = stdout.match(/\b\d{1,5}\b/g) || [];

        for (const value of matches) {
            const port = parseInt(value, 10);
            if (port > 0 && port <= 65535) {
                ports.add(port);
            }
        }

        const result = Array.from(ports).sort((a, b) => a - b);
        logger.debug(`[WindowsStrategy] Parsed ${result.length} ports: ${result.join(', ')}`);
        return result;
    }

    getErrorMessages(): { processNotFound: string; commandNotAvailable: string; requirements: string[] } {
        return {
            processNotFound: 'language_server process not found',
            commandNotAvailable: 'PowerShell command failed; please check system permissions',
            requirements: [
                'Antigravity is running',
                'language_server_windows_x64.exe process is running',
                'PowerShell Get-NetTCPConnection is available (Windows 8+)',
            ],
        };
    }

    getDiagnosticCommand(): string {
        const utf8Header = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
        return `chcp 65001 >nul && powershell -NoProfile -NonInteractive -Command "${utf8Header}Get-Process | Where-Object { $_.ProcessName -match 'language|antigravity' } | Select-Object Id,ProcessName,Path | Format-Table -AutoSize"`;
    }
}

/**
 * Unix (macOS/Linux) 平台策略
 */
export class UnixStrategy implements PlatformStrategy {
    private platform: string;
    private targetPid: number = 0;
    /** 可用的端口检测命令: 'lsof', 'ss', 或 'netstat' */
    private availablePortCommand: 'lsof' | 'ss' | 'netstat' | null = null;
    private portCommandChecked: boolean = false;

    constructor(platform: string) {
        this.platform = platform;
        logger.debug(`[UnixStrategy] Initialized, platform: ${platform}`);
    }

    private async detectAvailablePortCommand(): Promise<void> {
        if (this.portCommandChecked) {
            return;
        }
        this.portCommandChecked = true;

        const commands = ['lsof', 'ss', 'netstat'] as const;
        for (const cmd of commands) {
            try {
                await execAsync(`which ${cmd}`, { timeout: 3000 });
                this.availablePortCommand = cmd;
                logger.info(`[UnixStrategy] Port command available: ${cmd}`);
                return;
            } catch {
                // 命令不可用，继续尝试下一个
            }
        }

        logger.warn('[UnixStrategy] No port detection command available (lsof/ss/netstat)');
    }

    private isAntigravityProcess(commandLine: string): boolean {
        if (!commandLine.includes('--extension_server_port')) {
            return false;
        }
        if (!commandLine.includes('--csrf_token')) {
            return false;
        }
        return /--app_data_dir\s+antigravity\b/i.test(commandLine);
    }

    getProcessListCommand(processName: string): string {
        assertAllowedProcessName(processName);
        // ps -ww 保证命令行不被截断
        return `ps -ww -eo pid,ppid,args | grep "${processName}" | grep -v grep`;
    }

    parseProcessInfo(stdout: string): ProcessInfo[] {
        logger.debug('[UnixStrategy] Parsing process info...');

        if (!stdout || stdout.length > MAX_PARSE_INPUT_LENGTH) {
            logger.warn('[UnixStrategy] Empty or oversized process output, skipping');
            return [];
        }

        const lines = stdout.split('\n').filter(line => line.trim());
        const currentPid = process.pid;
        const candidates: Array<{ pid: number; ppid: number; extensionPort: number; csrfToken: string }> = [];

        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) {
                continue;
            }

            const pid = parseInt(parts[0], 10);
            const ppid = parseInt(parts[1], 10);
            const cmd = parts.slice(2).join(' ');

            if (Number.isNaN(pid) || Number.isNaN(ppid)) {
                continue;
            }

            const portMatch = cmd.match(/--extension_server_port[=\s]+(\d+)/);
            const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9-]+)/i);
            const csrfToken = sanitizeToken(tokenMatch?.[1]);

            if (csrfToken && this.isAntigravityProcess(cmd)) {
                const rawPort = portMatch?.[1] ? parseInt(portMatch[1], 10) : 0;
                const extensionPort = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 0;
                candidates.push({ pid, ppid, extensionPort, csrfToken });
                logger.debug(`[UnixStrategy] Found candidate: PID=${pid}, PPID=${ppid}, ExtPort=${extensionPort}`);
            }
        }

        if (candidates.length === 0) {
            logger.warn('[UnixStrategy] No Antigravity process found');
            return [];
        }

        // 当前进程的子进程优先，但保留全部候选
        return candidates
            .sort((a, b) => {
                if (a.ppid === currentPid) { return -1; }
                if (b.ppid === currentPid) { return 1; }
                return 0;
            })
            .map(({ pid, extensionPort, csrfToken }) => ({ pid, extensionPort, csrfToken }));
    }

    getPortListCommand(pid: number): string {
        assertValidPid(pid);
        this.targetPid = pid;

        if (this.platform === 'darwin') {
            return `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
        }

        switch (this.availablePortCommand) {
            case 'lsof':
                return `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s"`;
            case 'ss':
                return `ss -tlnp 2>/dev/null | grep "pid=${pid},"`;
            case 'netstat':
                return `netstat -tulpn 2>/dev/null | grep ${pid}`;
            default:
                return `ss -tlnp 2>/dev/null | grep "pid=${pid}," || lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null | grep -E "^\\S+\\s+${pid}\\s" || netstat -tulpn 2>/dev/null | grep ${pid}`;
        }
    }

    async ensurePortCommandAvailable(): Promise<void> {
        await this.detectAvailablePortCommand();
    }

    parseListeningPorts(stdout: string): number[] {
        if (!stdout || stdout.length > MAX_PARSE_INPUT_LENGTH) {
            return [];
        }

        const ports: number[] = [];
        const push = (port: number): void => {
            if (port > 0 && port <= 65535 && !ports.includes(port)) {
                ports.push(port);
            }
        };

        if (this.platform === 'darwin') {
            for (const line of stdout.split('\n')) {
                if (!line.trim() || !line.includes('(LISTEN)')) {
                    continue;
                }
                const portMatch = line.match(/[*\d.:]+:(\d+)\s+\(LISTEN\)/);
                if (portMatch) {
                    push(parseInt(portMatch[1], 10));
                }
            }
        } else {
            const ssRegex = /LISTEN\s+\d+\s+\d+\s+(?:\*|[\d.]+|\[[\da-f:]*\]):(\d+)/gi;
            let match: RegExpExecArray | null;
            while ((match = ssRegex.exec(stdout)) !== null) {
                push(parseInt(match[1], 10));
            }

            if (ports.length === 0) {
                const lsofRegex = /(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/gi;
                while ((match = lsofRegex.exec(stdout)) !== null) {
                    push(parseInt(match[1], 10));
                }
            }
        }

        logger.debug(`[UnixStrategy] Parsed ${ports.length} ports: ${ports.join(', ')}`);
        return ports.sort((a, b) => a - b);
    }

    getErrorMessages(): { processNotFound: string; commandNotAvailable: string; requirements: string[] } {
        return {
            processNotFound: 'Process not found',
            commandNotAvailable: 'Command check failed',
            requirements: ['lsof or netstat'],
        };
    }

    getDiagnosticCommand(): string {
        return "ps aux | grep -E 'language|antigravity' | grep -v grep";
    }
}

/** 校验端口（供测试与外部调用复用） */
export { assertValidPort };
