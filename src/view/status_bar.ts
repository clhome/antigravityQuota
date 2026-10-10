/**
 * antigravityQuota - 状态栏
 *
 * 只显示「最低剩余配额」的模型（或所选格式），点击打开仪表盘。
 * 加固点：tooltip 使用非受信 Markdown（isTrusted=false），
 * 服务端文本一律转义，避免命令链接 / 渲染注入。
 */

import * as vscode from 'vscode';
import { COMMANDS, STATUS_BAR_FORMAT, UI } from '../shared/constants';
import { ExtensionConfig } from '../shared/config_service';
import { escapeMarkdown } from '../shared/env_guard';
import { t } from '../shared/i18n';
import { ModelQuotaInfo, QuotaSnapshot } from '../shared/types';
import { resolveQuotaLevel } from '../engine/quota_client';

export class StatusBarController implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            UI.STATUS_BAR_PRIORITY,
        );
        this.statusBarItem.command = COMMANDS.OPEN;
        this.statusBarItem.text = `$(rocket) ${t('statusBar.init')}`;
        this.statusBarItem.tooltip = t('statusBar.tooltip');
        this.statusBarItem.show();
    }

    /** 用最新快照刷新状态栏 */
    update(snapshot: QuotaSnapshot, config: ExtensionConfig): void {
        const models = snapshot.models;

        if (!snapshot.isConnected || models.length === 0) {
            this.setOffline();
            return;
        }

        // 取剩余最少的模型作为「最需要关注」的指标
        let lowest = models[0];
        for (const model of models) {
            const pct = model.remainingPercentage ?? 0;
            if (pct < (lowest.remainingPercentage ?? 0)) {
                lowest = model;
            }
        }

        const percentage = lowest.remainingPercentage ?? 0;
        const icon = this.iconFor(percentage, config);
        const pctText = `${Math.floor(percentage)}%`;
        const label = this.safeLabel(lowest, config);

        switch (config.statusBarFormat) {
            case STATUS_BAR_FORMAT.ICON:
                this.statusBarItem.text = '🚀';
                break;
            case STATUS_BAR_FORMAT.DOT:
                this.statusBarItem.text = icon;
                break;
            case STATUS_BAR_FORMAT.PERCENT:
                this.statusBarItem.text = pctText;
                break;
            case STATUS_BAR_FORMAT.COMPACT:
                this.statusBarItem.text = `${icon} ${pctText}`;
                break;
            case STATUS_BAR_FORMAT.NAME_PERCENT:
                this.statusBarItem.text = `${label}: ${pctText}`;
                break;
            case STATUS_BAR_FORMAT.STANDARD:
            default:
                this.statusBarItem.text = `${icon} ${label}: ${pctText}`;
                break;
        }

        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = this.buildTooltip(snapshot, config, lowest);
    }

    setLoading(): void {
        this.statusBarItem.text = `$(sync~spin) ${t('statusBar.connecting')}`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = t('statusBar.tooltip');
    }

    setOffline(): void {
        this.statusBarItem.text = `$(error) ${t('statusBar.offline')}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.statusBarItem.tooltip = t('dashboard.offlineDesc');
    }

    setError(message: string): void {
        this.statusBarItem.text = `$(error) ${t('statusBar.error')}`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.tooltip = message;
    }

    private iconFor(percentage: number, config: ExtensionConfig): string {
        switch (resolveQuotaLevel(percentage, config.warningThreshold, config.criticalThreshold)) {
            case 'critical':
                return '🔴';
            case 'warning':
                return '🟡';
            default:
                return '🟢';
        }
    }

    private safeLabel(model: ModelQuotaInfo, config: ExtensionConfig): string {
        const label = model.label || model.modelId || t('common.unknown');
        return config.dataMasked ? maskText(label) : label;
    }

    /** 非受信 Markdown tooltip：所有服务端文本转义 */
    private buildTooltip(
        snapshot: QuotaSnapshot,
        config: ExtensionConfig,
        lowest: ModelQuotaInfo,
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        // 关键：不信任内容，禁止命令链接
        md.isTrusted = false;
        md.supportHtml = false;

        md.appendMarkdown(`**🚀 ${t('dashboard.title')}**\n\n`);
        md.appendMarkdown(`${t('statusBar.lowest')}: ${escapeMarkdown(this.safeLabel(lowest, config))} (${Math.floor(lowest.remainingPercentage ?? 0)}%)\n\n`);

        md.appendMarkdown('| Model | Remaining | Reset |\n');
        md.appendMarkdown('| :--- | ---: | ---: |\n');
        for (const model of snapshot.models) {
            const pct = `${Math.floor(model.remainingPercentage ?? 0)}%`;
            const reset = model.timeUntilResetFormatted || '-';
            md.appendMarkdown(`| ${escapeMarkdown(this.safeLabel(model, config))} | ${pct} | ${escapeMarkdown(reset)} |\n`);
        }

        if (snapshot.promptCredits) {
            md.appendMarkdown(`\n**${t('statusBar.credits')}**: ${Math.round(snapshot.promptCredits.available)} / ${Math.round(snapshot.promptCredits.monthly)}\n`);
        }

        md.appendMarkdown(`\n---\n*${t('statusBar.tooltip')}*`);
        return md;
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}

/** 简单遮罩：保留首尾字符 */
export function maskText(text: string): string {
    if (text.length <= 4) {
        return '***';
    }
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
}
