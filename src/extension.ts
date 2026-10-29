/**
 * antigravityQuota - 扩展入口
 *
 * 职责：只做「读取本机 Antigravity 配额 → 状态栏 + 极简仪表盘展示」。
 * 无凭证、无 OAuth、无外部网络、无定时唤醒、无多账号切换。
 */

import * as vscode from 'vscode';
import { ProcessHunter } from './engine/hunter';
import { LocalQuotaClient, createOfflineSnapshot } from './engine/quota_client';
import { QuotaPoller } from './engine/poller';
import { logger } from './shared/log_service';
import { configService, ExtensionConfig } from './shared/config_service';
import { i18n, t } from './shared/i18n';
import { COMMANDS, TIMING } from './shared/constants';
import { isConnectionError } from './shared/errors';
import { scanLegacyResidue, purgeLegacyResidue } from './shared/legacy_cleanup';
import { StatusBarController } from './view/status_bar';
import { DashboardPanel } from './view/dashboard';
import { QuotaSnapshot } from './shared/types';

let hunter: ProcessHunter;
let quotaClient: LocalQuotaClient;
let poller: QuotaPoller;
let statusBar: StatusBarController;
let extensionUri: vscode.Uri;

let systemOnline = false;
let connectRetryCount = 0;
let lastSnapshot: QuotaSnapshot | undefined;
let lastManualRefreshAt = 0;
let refreshInFlight: Promise<boolean> | undefined;

/** 已通知过的模型（配额耗尽 / 偏低），恢复后移除 */
const notifiedModels = new Set<string>();

/**
 * 扩展激活
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.init();
    logger.info('antigravityQuota activating...');

    const initialConfig = configService.getConfig();
    i18n.applyLanguageSetting(initialConfig.language);

    hunter = new ProcessHunter();
    quotaClient = new LocalQuotaClient();
    statusBar = new StatusBarController();
    extensionUri = context.extensionUri;
    context.subscriptions.push(statusBar);

    poller = new QuotaPoller({
        onTick: () => refreshQuota(),
    });

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN, () => openDashboard()),
        vscode.commands.registerCommand(COMMANDS.REFRESH, () => void manualRefresh()),
        vscode.commands.registerCommand(COMMANDS.SHOW_LOGS, () => logger.show()),
        vscode.commands.registerCommand(COMMANDS.PURGE_LEGACY, () => void purgeLegacyCommand()),
    );

    context.subscriptions.push(
        configService.onConfigChange(config => handleConfigChange(config)),
    );

    context.subscriptions.push({ dispose: () => poller?.stop() });

    await bootSystems();

    // 历史明文凭证残留检查（非阻塞，每个安装只主动提示一次）
    void checkLegacyResidue(context);

    logger.info('antigravityQuota ready');
}

export function deactivate(): void {
    logger.info('antigravityQuota shutting down...');
    poller?.stop();
    quotaClient?.disengage();
    systemOnline = false;
    logger.dispose();
}

/** 启动（或重试）连接流程 */
async function bootSystems(): Promise<void> {
    if (systemOnline) {
        return;
    }
    statusBar.setLoading();

    try {
        const info = await hunter.scanEnvironment(3);
        if (!info) {
            handleOfflineState();
            return;
        }

        quotaClient.engage(info.connectPort, info.csrfToken, info.protocol);
        systemOnline = true;
        connectRetryCount = 0;
        logger.info(`Connected to Antigravity language server on port ${info.connectPort} via ${info.protocol ?? 'http'}`);

        poller.start(configService.getRefreshIntervalMs());
        await refreshQuota();
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.error(`Boot failed: ${error.message}`);
        handleOfflineState();
    }
}

/** 处理离线状态：有限次自动重试 */
function handleOfflineState(): void {
    systemOnline = false;
    quotaClient.disengage();
    poller.stop();
    statusBar.setOffline();

    const snapshot = createOfflineSnapshot(t('dashboard.offlineDesc'));
    lastSnapshot = snapshot;
    DashboardPanel.current?.update(snapshot, configService.getConfig());

    if (connectRetryCount < TIMING.CONNECT_MAX_RETRY) {
        connectRetryCount++;
        logger.info(`Retry ${connectRetryCount}/${TIMING.CONNECT_MAX_RETRY} in ${TIMING.CONNECT_RETRY_DELAY_MS}ms`);
        setTimeout(() => {
            void bootSystems();
        }, TIMING.CONNECT_RETRY_DELAY_MS);
        return;
    }

    connectRetryCount = 0;
    void vscode.window.showErrorMessage(
        t('notify.offline'),
        t('common.retry'),
        t('common.openLogs'),
    ).then(selection => {
        if (selection === t('common.retry')) {
            void bootSystems();
        } else if (selection === t('common.openLogs')) {
            logger.show();
        }
    });
}

/** 拉取一次配额；single-flight 去重 */
function refreshQuota(): Promise<boolean> {
    if (refreshInFlight) {
        return refreshInFlight;
    }
    const task = doRefresh().finally(() => {
        refreshInFlight = undefined;
    });
    refreshInFlight = task;
    return task;
}

async function doRefresh(): Promise<boolean> {
    if (!systemOnline || !quotaClient.isEngaged()) {
        return false;
    }

    try {
        const snapshot = await quotaClient.fetchSnapshot();
        lastSnapshot = snapshot;

        const config = configService.getConfig();
        statusBar.update(snapshot, config);
        DashboardPanel.current?.update(snapshot, config);

        if (config.notificationEnabled) {
            notifyQuota(snapshot, config);
        }

        // 拉取成功且此前曾断开，则恢复轮询
        if (!poller.isRunning()) {
            poller.start(config.refreshIntervalMs);
        }
        return true;
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.error(`Quota fetch failed: ${error.message}`);
        statusBar.setError(error.message);

        // 连接层面失败（超时 / 拒绝 / 空响应）说明本地服务端可能已重启或
        // 端口变化 → 重新进入探测流程；服务端明确报错则等下轮重试。
        if (isConnectionError(error)) {
            logger.warn('Connection lost, re-running process discovery');
            systemOnline = false;
            quotaClient.disengage();
            poller.stop();
            lastSnapshot = lastSnapshot ?? createOfflineSnapshot(error.message);
            handleOfflineState();
        }

        return false;
    }
}

/** 手动刷新（带冷却） */
async function manualRefresh(): Promise<void> {
    const now = Date.now();
    if (now - lastManualRefreshAt < TIMING.REFRESH_COOLDOWN_MS) {
        const waitSec = Math.ceil((TIMING.REFRESH_COOLDOWN_MS - (now - lastManualRefreshAt)) / 1000);
        void vscode.window.showInformationMessage(`${t('dashboard.refreshing')} (${waitSec}s)`);
        return;
    }
    lastManualRefreshAt = now;

    if (!systemOnline) {
        connectRetryCount = 0;
        await bootSystems();
        return;
    }
    await refreshQuota();
}

function openDashboard(): void {
    const panel = DashboardPanel.show(extensionUri, {
        onRefresh: () => void manualRefresh(),
        onRetry: () => {
            connectRetryCount = 0;
            void bootSystems();
        },
        onShowLogs: () => logger.show(),
    });
    const snapshot = lastSnapshot ?? createOfflineSnapshot(t('dashboard.connecting'));
    panel.update(snapshot, configService.getConfig());
}

function handleConfigChange(config: ExtensionConfig): void {
    if (i18n.applyLanguageSetting(config.language)) {
        logger.info(`Language changed to ${i18n.getLocale()}`);
    }

    if (systemOnline) {
        poller.updateInterval(config.refreshIntervalMs);
    }
    if (lastSnapshot) {
        statusBar.update(lastSnapshot, config);
        DashboardPanel.current?.update(lastSnapshot, config);
    }
}

/** 配额告警（每模型只提示一次，恢复后重置） */
function notifyQuota(snapshot: QuotaSnapshot, config: ExtensionConfig): void {
    for (const model of snapshot.models) {
        const percentage = model.remainingPercentage;
        if (percentage === undefined) {
            continue;
        }
        const key = model.modelId || model.label;

        if (model.isExhausted) {
            if (!notifiedModels.has(key)) {
                notifiedModels.add(key);
                void vscode.window.showWarningMessage(
                    t('notify.exhausted', { model: model.label, time: model.timeUntilResetFormatted }),
                );
            }
            continue;
        }

        if (percentage <= config.warningThreshold) {
            if (!notifiedModels.has(key)) {
                notifiedModels.add(key);
                void vscode.window.showWarningMessage(
                    t('notify.warning', { model: model.label, percent: Math.floor(percentage) }),
                );
            }
            continue;
        }

        // 恢复健康 → 允许下次再次提醒
        notifiedModels.delete(key);
    }
}

/** 历史明文凭证残留检查（只提示一次；随时可手动执行清理命令） */
async function checkLegacyResidue(context: vscode.ExtensionContext): Promise<void> {
    const PROMPTED_KEY = 'legacyCredentialPromptShown';
    try {
        const report = await scanLegacyResidue();
        if (report.otherToolDir) {
            logger.warn(t('legacy.otherTool', { path: report.otherToolDir }));
        }
        if (report.sensitiveFiles.length === 0) {
            return;
        }

        logger.warn(`[LegacyCleanup] Found ${report.sensitiveFiles.length} credential-like leftover file(s)`);
        if (context.globalState.get<boolean>(PROMPTED_KEY, false)) {
            return;
        }
        await context.globalState.update(PROMPTED_KEY, true);

        const selection = await vscode.window.showWarningMessage(
            t('legacy.detail'),
            { detail: t('legacy.found', { files: report.sensitiveFiles.slice(0, 10).join('\n') }) },
            t('legacy.purge'),
            t('legacy.later'),
        );
        if (selection === t('legacy.purge')) {
            await runPurge(report);
        }
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.warn(`[LegacyCleanup] Scan failed: ${error.message}`);
    }
}

async function purgeLegacyCommand(): Promise<void> {
    try {
        const report = await scanLegacyResidue();
        if (report.sensitiveFiles.length === 0 && !report.dirExists) {
            void vscode.window.showInformationMessage(t('legacy.none'));
            return;
        }
        await runPurge(report);
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        void vscode.window.showErrorMessage(t('legacy.failed', { message: error.message }));
    }
}

async function runPurge(report: Awaited<ReturnType<typeof scanLegacyResidue>>): Promise<void> {
    try {
        const removed = await purgeLegacyResidue(report);
        void vscode.window.showInformationMessage(t('legacy.done', { count: removed }));
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        void vscode.window.showErrorMessage(t('legacy.failed', { message: error.message }));
    }
}
