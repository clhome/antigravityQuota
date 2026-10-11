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
import { ModelQuotaInfo, QuotaBucketInfo, QuotaGroupInfo, QuotaSnapshot } from '../shared/types';
import { resolveQuotaLevel } from '../engine/quota_client';

export class StatusBarController implements vscode.Disposable {
    private readonly geminiItem: vscode.StatusBarItem;
    private readonly claudeGptItem: vscode.StatusBarItem;

    constructor() {
        this.geminiItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            UI.STATUS_BAR_PRIORITY,
        );
        this.geminiItem.command = COMMANDS.OPEN;
        this.geminiItem.text = `$(rocket) ${t('statusBar.init')}`;
        this.geminiItem.tooltip = t('statusBar.tooltip');
        this.geminiItem.show();

        this.claudeGptItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            UI.STATUS_BAR_PRIORITY - 1,
        );
        this.claudeGptItem.command = COMMANDS.OPEN;
        this.claudeGptItem.hide();
    }

    /** 用最新快照刷新状态栏 */
    update(snapshot: QuotaSnapshot, config: ExtensionConfig): void {
        if (!snapshot.isConnected) {
            this.setOffline();
            return;
        }

        const groups = snapshot.groups;
        if (!groups || groups.length === 0) {
            // 回退到基于具体模型的旧展示模式
            this.updateFallbackSingle(snapshot, config);
            return;
        }

        const geminiGroup = groups.find(g => g.groupId === 'gemini' || g.displayName.toLowerCase().includes('gemini'));
        const claudeGptGroup = groups.find(g => g.groupId === 'claude_gpt' || /claude|gpt/i.test(g.displayName));

        if (geminiGroup) {
            this.renderGroupItem(this.geminiItem, 'Gemini', geminiGroup, snapshot, config);
            this.geminiItem.show();
        } else {
            this.geminiItem.hide();
        }

        if (claudeGptGroup) {
            this.renderGroupItem(this.claudeGptItem, 'Claude/GPT', claudeGptGroup, snapshot, config);
            this.claudeGptItem.show();
        } else {
            this.claudeGptItem.hide();
        }

        // 若两组都未匹配到（极为罕见情况），展示第一组
        if (!geminiGroup && !claudeGptGroup && groups[0]) {
            this.renderGroupItem(this.geminiItem, groups[0].displayName, groups[0], snapshot, config);
            this.geminiItem.show();
            this.claudeGptItem.hide();
        }
    }

    setLoading(): void {
        this.geminiItem.text = `$(sync~spin) ${t('statusBar.connecting')}`;
        this.geminiItem.backgroundColor = undefined;
        this.geminiItem.tooltip = t('statusBar.tooltip');
        this.geminiItem.show();
        this.claudeGptItem.hide();
    }

    setOffline(): void {
        this.geminiItem.text = `$(error) ${t('statusBar.offline')}`;
        this.geminiItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.geminiItem.tooltip = t('dashboard.offlineDesc');
        this.geminiItem.show();
        this.claudeGptItem.hide();
    }

    setError(message: string): void {
        this.geminiItem.text = `$(error) ${t('statusBar.error')}`;
        this.geminiItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.geminiItem.tooltip = message;
        this.geminiItem.show();
        this.claudeGptItem.hide();
    }

    private renderGroupItem(
        item: vscode.StatusBarItem,
        shortLabel: string,
        group: QuotaGroupInfo,
        snapshot: QuotaSnapshot,
        config: ExtensionConfig,
    ): void {
        // 取短板百分比（优先 lowestBucket，否则默认 100%）
        const lowestBucket = group.lowestBucket;
        const percentage = lowestBucket?.remainingPercentage ?? 100;
        const icon = this.iconFor(percentage, config);
        const pctText = `${Math.floor(percentage)}%`;

        switch (config.statusBarFormat) {
            case STATUS_BAR_FORMAT.ICON:
                item.text = shortLabel.toLowerCase().includes('gemini') ? '♊' : '🤖';
                break;
            case STATUS_BAR_FORMAT.DOT:
                item.text = icon;
                break;
            case STATUS_BAR_FORMAT.PERCENT:
                item.text = pctText;
                break;
            case STATUS_BAR_FORMAT.COMPACT:
                item.text = `${icon} ${shortLabel} ${pctText}`;
                break;
            case STATUS_BAR_FORMAT.NAME_PERCENT:
                item.text = `${shortLabel}: ${pctText}`;
                break;
            case STATUS_BAR_FORMAT.STANDARD:
            default:
                item.text = `${icon} ${shortLabel}: ${pctText}`;
                break;
        }

        item.backgroundColor = undefined;
        item.tooltip = this.buildGroupTooltip(group, snapshot, config);
    }

    private updateFallbackSingle(snapshot: QuotaSnapshot, config: ExtensionConfig): void {
        const models = snapshot.models;
        if (models.length === 0) {
            this.setOffline();
            return;
        }

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

        this.geminiItem.text = `${icon} ${label}: ${pctText}`;
        this.geminiItem.backgroundColor = undefined;
        this.geminiItem.tooltip = this.buildLegacyTooltip(snapshot, config, lowest);
        this.geminiItem.show();
        this.claudeGptItem.hide();
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

    /** 生成分类专属的富文本 Tooltip */
    private buildGroupTooltip(
        group: QuotaGroupInfo,
        snapshot: QuotaSnapshot,
        config: ExtensionConfig,
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = false;
        md.supportHtml = false;

        md.appendMarkdown(`**🚀 ${escapeMarkdown(group.displayName)}**\n\n`);
        if (group.description) {
            md.appendMarkdown(`*${escapeMarkdown(group.description)}*\n\n`);
        }

        if (group.buckets.length > 0) {
            md.appendMarkdown('| 限制类型 (Limit) | 剩余 (Remaining) | 重置时间 (Reset) |\n');
            md.appendMarkdown('| :--- | ---: | ---: |\n');
            for (const b of group.buckets) {
                const pct = b.remainingPercentage !== undefined ? `${Math.floor(b.remainingPercentage)}%` : '-';
                const reset = b.timeUntilResetFormatted || '-';
                const bucketName = this.formatBucketName(b);
                md.appendMarkdown(`| ${escapeMarkdown(bucketName)} | ${pct} | ${escapeMarkdown(reset)} |\n`);
            }
            md.appendMarkdown('\n');

            // 补充各桶的详细说明（如 "You have used some of your weekly limit..."）
            for (const b of group.buckets) {
                if (b.description) {
                    md.appendMarkdown(`> 💡 **${escapeMarkdown(this.formatBucketName(b))}**: ${escapeMarkdown(b.description)}\n\n`);
                }
            }
        }

        if (group.models.length > 0) {
            md.appendMarkdown(`---\n**包含模型 (${group.models.length}):**\n\n`);
            for (const model of group.models) {
                const pct = model.remainingPercentage !== undefined ? `${Math.floor(model.remainingPercentage)}%` : '-';
                const reset = model.timeUntilResetFormatted || '-';
                md.appendMarkdown(`- **${escapeMarkdown(this.safeLabel(model, config))}**: ${pct} (重置: ${escapeMarkdown(reset)})\n`);
            }
        }

        if (snapshot.promptCredits) {
            md.appendMarkdown(`\n---\n**${t('statusBar.credits')}**: ${Math.round(snapshot.promptCredits.available)} / ${Math.round(snapshot.promptCredits.monthly)}\n`);
        }

        md.appendMarkdown(`\n---\n*${t('statusBar.tooltip')}*`);
        return md;
    }

    private formatBucketName(bucket: QuotaBucketInfo): string {
        const name = bucket.displayName || bucket.bucketId;
        if (bucket.window === 'weekly' || name.toLowerCase().includes('weekly')) {
            return `每周配额 (${name})`;
        }
        if (bucket.window === '5h' || name.toLowerCase().includes('five hour')) {
            return `5小时配额 (${name})`;
        }
        return name;
    }

    private buildLegacyTooltip(
        snapshot: QuotaSnapshot,
        config: ExtensionConfig,
        lowest: ModelQuotaInfo,
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
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
        this.geminiItem.dispose();
        this.claudeGptItem.dispose();
    }
}

/** 简单遮罩：保留首尾字符 */
export function maskText(text: string): string {
    if (text.length <= 4) {
        return '***';
    }
    return `${text.slice(0, 2)}***${text.slice(-2)}`;
}
