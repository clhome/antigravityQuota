/**
 * antigravityQuota - 进程探测
 *
 * 只做一件事：在**本机**找到 Antigravity 的 language server，
 * 并返回 {connectPort, csrfToken}。
 *
 * 加固点：
 *  - 所有网络探测固定指向 127.0.0.1，端口经数值校验；
 *  - CSRF token 经格式校验后才参与请求；
 *  - 命令输出与 HTTP 响应均有大小上限；
 *  - 探测请求完成后主动销毁 socket。
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import * as process from 'process';
import { WindowsStrategy, UnixStrategy } from './strategies';
import { logger } from '../shared/log_service';
import { API_ENDPOINTS, PROCESS_NAMES, TIMING } from '../shared/constants';
import { isValidCsrfToken, isValidPort } from '../shared/env_guard';
import { EnvironmentScanResult, PlatformStrategy, ProcessInfo, ScanDiagnostics } from '../shared/types';

const execAsync = promisify(exec);
const LOCAL_HOST = '127.0.0.1';
const MAX_COMMAND_OUTPUT = TIMING.MAX_COMMAND_OUTPUT_BYTES;

/**
 * 进程探测类：负责扫描系统进程，找到 Antigravity Language Server
 */
export class ProcessHunter {
    private strategy: PlatformStrategy;
    private targetProcess: string;
    private lastDiagnostics: ScanDiagnostics = {
        scan_method: 'unknown',
        target_process: '',
        attempts: 0,
        found_candidates: 0,
    };

    constructor() {
        logger.debug(`Initializing ProcessHunter (platform=${process.platform}, arch=${process.arch})`);

        if (process.platform === 'win32') {
            this.strategy = new WindowsStrategy();
            this.targetProcess = PROCESS_NAMES.windows;
        } else if (process.platform === 'darwin') {
            this.strategy = new UnixStrategy('darwin');
            this.targetProcess = process.arch === 'arm64'
                ? PROCESS_NAMES.darwin_arm
                : PROCESS_NAMES.darwin_x64;
        } else {
            this.strategy = new UnixStrategy('linux');
            this.targetProcess = PROCESS_NAMES.linux;
        }

        logger.debug(`Target process: ${this.targetProcess}`);
    }

    /**
     * 扫描环境，查找 Antigravity 进程
     * @param maxAttempts 最大尝试次数（默认 3 次）
     */
    async scanEnvironment(maxAttempts: number = 3): Promise<EnvironmentScanResult | null> {
        const attempts = Math.max(1, Math.min(5, Math.floor(maxAttempts) || 1));
        logger.info(`Scanning environment, max attempts: ${attempts}`);

        const resultByName = await this.scanByProcessName(attempts);
        if (resultByName) {
            return resultByName;
        }

        logger.info('Process name search failed, trying keyword search (csrf_token)...');
        const resultByKeyword = await this.scanByKeyword();
        if (resultByKeyword) {
            return resultByKeyword;
        }

        await this.runDiagnostics();
        return null;
    }

    getLastDiagnostics(): ScanDiagnostics {
        return { ...this.lastDiagnostics };
    }

    private async scanByProcessName(maxAttempts: number): Promise<EnvironmentScanResult | null> {
        let powershellTimeoutRetried = false;
        this.lastDiagnostics = {
            scan_method: 'process_name',
            target_process: this.targetProcess,
            attempts: maxAttempts,
            found_candidates: 0,
        };

        for (let i = 0; i < maxAttempts; i++) {
            logger.debug(`Attempt ${i + 1}/${maxAttempts} (by process name)...`);

            try {
                const cmd = this.strategy.getProcessListCommand(this.targetProcess);
                const { stdout, stderr } = await execAsync(cmd, {
                    timeout: TIMING.PROCESS_CMD_TIMEOUT_MS,
                    maxBuffer: MAX_COMMAND_OUTPUT,
                });

                if (stderr && stderr.trim()) {
                    logger.warn(`Command stderr: ${stderr.substring(0, 500)}`);
                }

                if (!stdout || !stdout.trim()) {
                    logger.debug('Command returned empty output, process may not be running');
                    continue;
                }

                const candidates = this.strategy.parseProcessInfo(stdout);
                if (candidates.length > 0) {
                    logger.info(`Found ${candidates.length} candidate process(es)`);
                    this.lastDiagnostics.found_candidates = candidates.length;

                    for (const info of candidates) {
                        logger.info(`Checking process PID=${info.pid}, extPort=${info.extensionPort}`);
                        const result = await this.verifyAndConnect(info);
                        if (result) {
                            return result;
                        }
                    }
                    logger.warn('All candidates failed verification in this attempt');
                }
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                const errorMsg = error.message.toLowerCase();
                logger.error(`Attempt ${i + 1} failed: ${error.message}`);

                if (process.platform === 'win32' && this.strategy instanceof WindowsStrategy) {
                    if (errorMsg.includes('cannot be loaded because running scripts is disabled') ||
                        errorMsg.includes('executionpolicy') ||
                        errorMsg.includes('禁止运行脚本')) {
                        logger.error('PowerShell execution policy may be blocking scripts. Try: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned');
                    }
                    if (errorMsg.includes('rpc server') || errorMsg.includes('wmi') || errorMsg.includes('invalid class')) {
                        logger.error('WMI service may not be running. Try: net start winmgmt');
                    }
                    if (!powershellTimeoutRetried &&
                        (errorMsg.includes('timeout') || errorMsg.includes('timed out') || errorMsg.includes('超时'))) {
                        logger.warn('PowerShell command timed out (likely cold start), retrying after warm-up...');
                        powershellTimeoutRetried = true;
                        i--;
                        await this.delay(3000);
                        continue;
                    }
                }
            }

            if (i < maxAttempts - 1) {
                await this.delay(100);
            }
        }

        return null;
    }

    /** 备用方案：按关键字扫描（查找包含 csrf_token 的进程），仅 Windows */
    private async scanByKeyword(): Promise<EnvironmentScanResult | null> {
        if (process.platform !== 'win32' || !(this.strategy instanceof WindowsStrategy)) {
            return null;
        }

        this.lastDiagnostics = {
            scan_method: 'keyword',
            target_process: this.targetProcess,
            attempts: 1,
            found_candidates: 0,
        };

        try {
            const cmd = (this.strategy as WindowsStrategy).getProcessByKeywordCommand();
            const { stdout, stderr } = await execAsync(cmd, {
                timeout: TIMING.PROCESS_CMD_TIMEOUT_MS,
                maxBuffer: MAX_COMMAND_OUTPUT,
            });

            if (stderr) {
                logger.warn(`StdErr: ${stderr}`);
            }

            const candidates = this.strategy.parseProcessInfo(stdout);
            if (candidates.length > 0) {
                logger.info(`Found ${candidates.length} keyword candidate(s)`);
                this.lastDiagnostics.found_candidates = candidates.length;

                for (const info of candidates) {
                    logger.info(`Checking keyword candidate: PID=${info.pid}`);
                    const result = await this.verifyAndConnect(info);
                    if (result) {
                        return result;
                    }
                }
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error(`Keyword search failed: ${error.message}`);
        }

        return null;
    }

    private async verifyAndConnect(info: ProcessInfo): Promise<EnvironmentScanResult | null> {
        if (!isValidCsrfToken(info.csrfToken)) {
            logger.warn(`Rejecting candidate PID=${info.pid}: malformed csrf token`);
            return null;
        }

        const ports = await this.identifyPorts(info.pid);
        logger.debug(`Listening ports: ${ports.join(', ')}`);
        this.lastDiagnostics.ports = ports;

        if (ports.length > 0) {
            const validPort = await this.verifyConnection(ports, info.csrfToken);
            this.lastDiagnostics.verified_port = validPort ?? null;
            this.lastDiagnostics.verification_success = Boolean(validPort);

            if (validPort) {
                logger.info(`Connection verified on port ${validPort}`);
                return {
                    extensionPort: info.extensionPort,
                    connectPort: validPort,
                    csrfToken: info.csrfToken,
                };
            }
        }

        return null;
    }

    private async runDiagnostics(): Promise<void> {
        logger.warn('All scan attempts failed, running diagnostics...');
        logger.info(`Target process name: ${this.targetProcess}`);
        logger.info(`Platform: ${process.platform}, Arch: ${process.arch}`);

        if (process.platform === 'win32') {
            logger.info('Windows troubleshooting tips:');
            logger.info('  1. Ensure Antigravity is running');
            logger.info('  2. Check language_server_windows_x64.exe in Task Manager');
            logger.info('  3. Restart Antigravity');
        }

        try {
            const diagCmd = this.strategy.getDiagnosticCommand();
            const { stdout, stderr } = await execAsync(diagCmd, {
                timeout: 10000,
                maxBuffer: MAX_COMMAND_OUTPUT,
            });

            // 脱敏：隐藏 csrf_token，防止日志泄露
            const sanitize = (text: string): string =>
                text.replace(/(--csrf_token[=\s]+)([a-zA-Z0-9_-]+)/gi, '$1***REDACTED***');

            if (stdout && stdout.trim()) {
                logger.info(`Related processes found:\n${sanitize(stdout).substring(0, 2000)}`);
            } else {
                logger.warn('No related processes found (language_server/antigravity)');
            }

            if (stderr && stderr.trim()) {
                logger.warn(`Diagnostic stderr: ${sanitize(stderr).substring(0, 500)}`);
            }
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error(`Diagnostic command failed: ${error.message}`);
        }
    }

    private async identifyPorts(pid: number): Promise<number[]> {
        try {
            if (this.strategy instanceof UnixStrategy) {
                await this.strategy.ensurePortCommandAvailable();
            }

            const cmd = this.strategy.getPortListCommand(pid);
            const { stdout } = await execAsync(cmd, {
                timeout: TIMING.PROCESS_CMD_TIMEOUT_MS,
                maxBuffer: MAX_COMMAND_OUTPUT,
            });
            return this.strategy.parseListeningPorts(stdout).filter(isValidPort);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error(`Port identification failed: ${error.message}`);
            return [];
        }
    }

    private async verifyConnection(ports: number[], token: string): Promise<number | null> {
        for (const port of ports) {
            if (await this.pingPort(port, token)) {
                return port;
            }
        }
        return null;
    }

    /** 探测端口是否为可用的 Antigravity language server（仅回环地址） */
    private pingPort(port: number, token: string): Promise<boolean> {
        return new Promise(resolve => {
            if (!isValidPort(port) || !isValidCsrfToken(token)) {
                resolve(false);
                return;
            }

            const options: https.RequestOptions = {
                hostname: LOCAL_HOST,
                port,
                path: API_ENDPOINTS.GET_UNLEASH_DATA,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Codeium-Csrf-Token': token,
                    'Connect-Protocol-Version': '1',
                },
                // 本地 language server 使用自签名证书；连接固定为 127.0.0.1，
                // 且不发送任何长期凭证（仅 csrf token，由本机进程自持）。
                rejectUnauthorized: false,
                timeout: TIMING.PROCESS_CMD_TIMEOUT_MS,
                agent: false, // 绕过代理，直接连接 loopback
            };

            const req = https.request(options, res => {
                const ok = res.statusCode === 200;
                res.resume(); // 丢弃响应体，释放 socket
                resolve(ok);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.write(JSON.stringify({ wrapper_data: {} }));
            req.end();
        });
    }

    getErrorMessages(): { processNotFound: string; commandNotAvailable: string; requirements: string[] } {
        return this.strategy.getErrorMessages();
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
