/**
 * antigravityQuota - 配置服务
 *
 * 只暴露最小配额查看所需的配置项，全部来自 VS Code 原生设置，
 * 不写任何自有状态文件 / 全局状态。
 */

import * as vscode from 'vscode';
import {
    CONFIG_SECTION,
    CONFIG_KEYS,
    LOG_LEVELS,
    QUOTA_THRESHOLDS,
    STATUS_BAR_FORMAT,
    TIMING,
} from './constants';
import { clampNumber, clampRefreshIntervalMs } from './env_guard';
import { normalizeLocaleInput } from './i18n';

const SUPPORTED_STATUS_BAR_FORMATS: ReadonlySet<string> = new Set(Object.values(STATUS_BAR_FORMAT));
const SUPPORTED_LOG_LEVELS: ReadonlySet<string> = new Set(Object.values(LOG_LEVELS));

/** 精简后的配置对象 */
export interface ExtensionConfig {
    /** 刷新间隔（秒） */
    refreshInterval: number;
    /** 刷新间隔（毫秒，已夹取到 [60s, 3600s]） */
    refreshIntervalMs: number;
    /** 日志级别 */
    logLevel: string;
    /** 是否发送配额告警通知 */
    notificationEnabled: boolean;
    /** 状态栏显示格式 */
    statusBarFormat: string;
    /** 警告阈值（%） */
    warningThreshold: number;
    /** 危险阈值（%） */
    criticalThreshold: number;
    /** 是否在界面上遮罩账号等敏感信息 */
    dataMasked: boolean;
    /** 语言设置（'auto' | 'en' | 'zh-cn'） */
    language: string;
}

class ConfigService {
    getConfig(): ExtensionConfig {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

        const refreshIntervalMs = clampRefreshIntervalMs(
            Math.round(
                clampNumber(
                    config.get<number>(CONFIG_KEYS.REFRESH_INTERVAL, TIMING.DEFAULT_REFRESH_INTERVAL_MS / 1000),
                    TIMING.MIN_REFRESH_INTERVAL_MS / 1000,
                    TIMING.MAX_REFRESH_INTERVAL_MS / 1000,
                    TIMING.DEFAULT_REFRESH_INTERVAL_MS / 1000,
                ) * 1000,
            ),
        );

        const criticalThreshold = clampNumber(
            config.get<number>(CONFIG_KEYS.CRITICAL_THRESHOLD, QUOTA_THRESHOLDS.CRITICAL_DEFAULT),
            1,
            50,
            QUOTA_THRESHOLDS.CRITICAL_DEFAULT,
        );
        // 警告阈值必须严格高于危险阈值，否则 UI 语义颠倒
        const warningThreshold = clampNumber(
            config.get<number>(CONFIG_KEYS.WARNING_THRESHOLD, QUOTA_THRESHOLDS.WARNING_DEFAULT),
            Math.min(80, criticalThreshold + 1),
            80,
            Math.max(QUOTA_THRESHOLDS.WARNING_DEFAULT, criticalThreshold + 1),
        );

        const rawLogLevel = String(config.get<string>(CONFIG_KEYS.LOG_LEVEL, LOG_LEVELS.INFO)).toLowerCase();
        const rawStatusBarFormat = String(
            config.get<string>(CONFIG_KEYS.STATUS_BAR_FORMAT, STATUS_BAR_FORMAT.STANDARD),
        );

        return {
            refreshInterval: refreshIntervalMs / 1000,
            refreshIntervalMs,
            logLevel: SUPPORTED_LOG_LEVELS.has(rawLogLevel) ? rawLogLevel : LOG_LEVELS.INFO,
            notificationEnabled: config.get<boolean>(CONFIG_KEYS.NOTIFICATION_ENABLED, true) === true,
            statusBarFormat: SUPPORTED_STATUS_BAR_FORMATS.has(rawStatusBarFormat)
                ? rawStatusBarFormat
                : STATUS_BAR_FORMAT.STANDARD,
            warningThreshold,
            criticalThreshold,
            dataMasked: config.get<boolean>(CONFIG_KEYS.DATA_MASKED, false) === true,
            language: normalizeLocaleInput(String(config.get<string>(CONFIG_KEYS.LANGUAGE, 'auto'))),
        };
    }

    getRefreshIntervalMs(): number {
        return this.getConfig().refreshIntervalMs;
    }

    /** 监听本扩展命名空间下的配置变化 */
    onConfigChange(listener: (config: ExtensionConfig) => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                listener(this.getConfig());
            }
        });
    }
}

export const configService = new ConfigService();
