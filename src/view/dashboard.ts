/**
 * antigravityQuota - 极简配额仪表盘
 *
 * 单个 Webview 面板：计划信息 + 模型配额列表 + 刷新按钮。
 * 安全加固：
 *  - 严格 CSP：default-src 'none'，脚本走 nonce，样式仅允许扩展资源；
 *  - nonce 使用 crypto.randomBytes；
 *  - 不启用 retainContextWhenHidden，避免后台常驻；
 *  - 服务端文本在渲染时统一 textContent 写入（webview 侧）。
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ExtensionConfig } from '../shared/config_service';
import { i18n, t } from '../shared/i18n';
import { QuotaSnapshot } from '../shared/types';
import { resolveQuotaLevel } from '../engine/quota_client';

export interface DashboardMessageTarget {
    onRefresh: () => void;
    onRetry: () => void;
    onShowLogs: () => void;
}

interface DashboardBucketPayload {
    bucketId: string;
    displayName: string;
    description?: string;
    window: string;
    percentage: number;
    level: 'healthy' | 'warning' | 'critical';
    resetIn: string;
    resetAt: string;
}

interface DashboardGroupPayload {
    groupId: string;
    displayName: string;
    description?: string;
    buckets: DashboardBucketPayload[];
    lowestPercentage: number;
    level: 'healthy' | 'warning' | 'critical';
}

interface DashboardModelPayload {
    label: string;
    modelId: string;
    percentage: number;
    level: 'healthy' | 'warning' | 'critical';
    exhausted: boolean;
    resetIn: string;
    resetAt: string;
    tagTitle?: string;
}

interface DashboardPayload {
    connected: boolean;
    errorMessage?: string;
    updatedAt: string;
    locale: string;
    dir: 'ltr' | 'rtl';
    groups: DashboardGroupPayload[];
    models: DashboardModelPayload[];
    promptCredits?: {
        available: number;
        monthly: number;
        remainingPercentage: number;
    };
    user?: {
        name: string;
        email: string;
        planName: string;
        tier: string;
    };
    i18n: Record<string, string>;
}

export class DashboardPanel implements vscode.Disposable {
    public static current: DashboardPanel | undefined;
    private static readonly viewType = 'antigravityQuota.dashboard';

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private lastPayload: DashboardPayload | undefined;
    private disposed = false;

    static show(
        extensionUri: vscode.Uri,
        target: DashboardMessageTarget,
    ): DashboardPanel {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (DashboardPanel.current) {
            DashboardPanel.current.panel.reveal(column);
            DashboardPanel.current.updateTarget(target);
            return DashboardPanel.current;
        }

        const panel = vscode.window.createWebviewPanel(
            DashboardPanel.viewType,
            t('dashboard.title'),
            column,
            {
                enableScripts: true,
                enableCommandUris: false,
                retainContextWhenHidden: false,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'out', 'view', 'webview'),
                    vscode.Uri.joinPath(extensionUri, 'assets'),
                ],
            },
        );
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'icon.png');

        DashboardPanel.current = new DashboardPanel(panel, extensionUri, target);
        return DashboardPanel.current;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly extensionUri: vscode.Uri,
        private target: DashboardMessageTarget,
    ) {
        this.panel = panel;
        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message: unknown) => this.handleMessage(message),
            null,
            this.disposables,
        );
    }

    private updateTarget(target: DashboardMessageTarget): void {
        this.target = target;
    }

    private handleMessage(message: unknown): void {
        if (!message || typeof message !== 'object') {
            return;
        }
        const type = (message as { type?: unknown }).type;
        switch (type) {
            case 'ready':
                if (this.lastPayload) {
                    void this.postMessage(this.lastPayload);
                }
                break;
            case 'refresh':
                this.target.onRefresh();
                break;
            case 'retry':
                this.target.onRetry();
                break;
            case 'openLogs':
                this.target.onShowLogs();
                break;
            default:
                break;
        }
    }

    /** 用最新快照刷新面板 */
    update(snapshot: QuotaSnapshot, config: ExtensionConfig): void {
        this.lastPayload = this.buildPayload(snapshot, config);
        void this.postMessage(this.lastPayload);
    }

    private async postMessage(payload: DashboardPayload): Promise<void> {
        if (this.disposed) {
            return;
        }
        try {
            await this.panel.webview.postMessage({ type: 'render', payload });
        } catch {
            // 面板已关闭，忽略
        }
    }

    private buildPayload(snapshot: QuotaSnapshot, config: ExtensionConfig): DashboardPayload {
        const groups: DashboardGroupPayload[] = (snapshot.groups || []).map(group => {
            const buckets: DashboardBucketPayload[] = group.buckets.map(b => {
                const pct = b.remainingPercentage ?? 100;
                return {
                    bucketId: b.bucketId,
                    displayName: b.displayName,
                    description: b.description,
                    window: b.window,
                    percentage: Math.round(pct * 100) / 100,
                    level: resolveQuotaLevel(pct, config.warningThreshold, config.criticalThreshold),
                    resetIn: b.timeUntilResetFormatted,
                    resetAt: b.resetTimeDisplay,
                };
            });

            const lowestPct = group.lowestBucket?.remainingPercentage ?? 100;
            return {
                groupId: group.groupId,
                displayName: group.displayName,
                description: group.description,
                buckets,
                lowestPercentage: Math.round(lowestPct * 100) / 100,
                level: resolveQuotaLevel(lowestPct, config.warningThreshold, config.criticalThreshold),
            };
        });

        const models: DashboardModelPayload[] = snapshot.models.map(model => {
            const percentage = model.remainingPercentage ?? 0;
            return {
                label: model.label,
                modelId: model.modelId,
                percentage: Math.round(percentage * 100) / 100,
                level: resolveQuotaLevel(percentage, config.warningThreshold, config.criticalThreshold),
                exhausted: model.isExhausted,
                resetIn: model.timeUntilResetFormatted,
                resetAt: model.resetTimeDisplay,
                tagTitle: model.tagTitle,
            };
        });

        const user = snapshot.userInfo
            ? {
                name: config.dataMasked ? '***' : snapshot.userInfo.name,
                email: config.dataMasked ? maskEmail(snapshot.userInfo.email) : snapshot.userInfo.email,
                planName: snapshot.userInfo.planName,
                tier: snapshot.userInfo.tier,
            }
            : undefined;

        return {
            connected: snapshot.isConnected,
            errorMessage: snapshot.errorMessage,
            updatedAt: snapshot.timestamp.toLocaleTimeString(),
            locale: i18n.getLocale(),
            dir: i18n.isRtl() ? 'rtl' : 'ltr',
            groups,
            models,
            promptCredits: snapshot.promptCredits
                ? {
                    available: snapshot.promptCredits.available,
                    monthly: snapshot.promptCredits.monthly,
                    remainingPercentage: snapshot.promptCredits.remainingPercentage,
                }
                : undefined,
            user,
            i18n: i18n.getAllTranslations(),
        };
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('base64');
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'view', 'webview', 'dashboard.js'),
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'view', 'webview', 'dashboard.css'),
        );
        const iconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'assets', 'icon.png'),
        );
        const faviconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'assets', 'favicon.ico'),
        );

        const csp = buildDashboardCsp(webview.cspSource, nonce);

        return `<!DOCTYPE html>
<html lang="${i18n.getLocale()}" dir="${i18n.isRtl() ? 'rtl' : 'ltr'}">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <link rel="icon" href="${faviconUri}" />
    <title>${t('dashboard.title')}</title>
</head>
<body>
    <header class="topbar">
        <div class="brandline">
            <img class="brand" src="${iconUri}" alt="" width="20" height="20" />
            <h1 class="title"></h1>
        </div>
        <div class="actions">
            <button id="refresh" class="btn" type="button"></button>
            <button id="logs" class="btn btn-secondary" type="button"></button>
        </div>
    </header>
    <section id="meta" class="meta"></section>
    <section id="banner" class="banner hidden"></section>
    <section id="groups" class="groups"></section>
    <section id="models" class="models"></section>
    <footer class="footer">
        <span id="updated"></span>
        <span class="local-only"></span>
    </footer>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        DashboardPanel.current = undefined;
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
        this.panel.dispose();
    }
}

/**
 * 构建仪表盘 CSP。
 * 刻意不包含任何宽松指令：脚本走 nonce，样式与图标仅允许扩展资源 URI，
 * 网络、字体、对象、base 与表单提交一律禁用。
 */
export function buildDashboardCsp(cspSource: string, nonce: string): string {
    return [
        "default-src 'none'",
        `style-src ${cspSource}`,
        `script-src 'nonce-${nonce}'`,
        `img-src ${cspSource} data:`,
        "connect-src 'none'",
        "font-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; ');
}

function maskEmail(email: string): string {
    const at = email.indexOf('@');
    if (at <= 0) {
        return '***';
    }
    const name = email.slice(0, at);
    const domain = email.slice(at + 1);
    const head = name.slice(0, Math.min(2, name.length));
    return `${head}***@${domain}`;
}
