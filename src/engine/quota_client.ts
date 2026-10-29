/**
 * antigravityQuota - 本地配额客户端
 *
 * 唯一的数据来源：本机 Antigravity language server 的 GetUserStatus 接口。
 * 该接口由 Antigravity 进程自身在 127.0.0.1 上以随机端口暴露，
 * 认证仅依赖该进程自己生成的 CSRF token。
 *
 * 因此本扩展：
 *  - 不申请、不保存任何 Google/OAuth 凭证；
 *  - 不访问任何外部域名；
 *  - 只与 127.0.0.1:<port> 通信。
 *
 * 加固点：
 *  - 主机固定 127.0.0.1，端口经校验；
 *  - 请求超时并主动销毁；
 *  - 响应体大小上限，防止内存放大；
 *  - 解析时对字段做类型与范围校验，坏数据只降级不清洗执行路径。
 */

import * as http from 'http';
import * as https from 'https';
import { API_ENDPOINTS, TIMING, QUOTA_THRESHOLDS } from '../shared/constants';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';
import { AntigravityError, ConnectionError } from '../shared/errors';
import { assertValidPort, isValidCsrfToken } from '../shared/env_guard';
import {
    ClientModelConfig,
    ClientModelSort,
    ModelQuotaInfo,
    PromptCreditsInfo,
    QuotaBucketInfo,
    QuotaGroupInfo,
    QuotaSnapshot,
    ServerUserQuotaSummaryResponse,
    ServerUserStatusResponse,
    UserInfo,
} from '../shared/types';

const LOCAL_HOST = '127.0.0.1';

/** 请求体（固定结构，无外部输入） */
const REQUEST_METADATA = {
    metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
        locale: 'en',
    },
} as const;

export class LocalQuotaClient {
    private port = 0;
    private token = '';
    private protocol: 'http' | 'https' = 'http';

    /** 绑定连接参数 */
    engage(port: number, token: string, protocol: 'http' | 'https' = 'http'): void {
        this.port = assertValidPort(port);
        if (!isValidCsrfToken(token)) {
            throw new Error('Invalid CSRF token');
        }
        this.token = token;
        this.protocol = protocol;
        logger.info(`[QuotaClient] Engaged on ${this.protocol}://127.0.0.1:${this.port}`);
    }

    isEngaged(): boolean {
        return this.port > 0 && this.token.length > 0;
    }

    disengage(): void {
        this.port = 0;
        this.token = '';
        this.protocol = 'http';
    }

    /** 拉取一次配额快照（同时拉取用户状态与分类配额汇总） */
    async fetchSnapshot(): Promise<QuotaSnapshot> {
        if (!this.isEngaged()) {
            throw new ConnectionError(t('statusBar.offline'));
        }

        const userStatusPromise = this.transmit<ServerUserStatusResponse>(
            API_ENDPOINTS.GET_USER_STATUS,
            REQUEST_METADATA,
        );

        const quotaSummaryPromise = this.transmit<ServerUserQuotaSummaryResponse>(
            API_ENDPOINTS.RETRIEVE_USER_QUOTA_SUMMARY,
            REQUEST_METADATA,
        ).catch(err => {
            logger.warn(`[QuotaClient] RetrieveUserQuotaSummary failed, falling back: ${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        });

        const [userStatusRaw, quotaSummaryRaw] = await Promise.all([userStatusPromise, quotaSummaryPromise]);
        return LocalQuotaClient.decode(userStatusRaw, quotaSummaryRaw);
    }

    /** 与本地 language server 通信（仅回环地址） */
    private transmit<T>(endpoint: string, payload: object): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.isEngaged()) {
                reject(new ConnectionError(t('statusBar.offline')));
                return;
            }

            const data = JSON.stringify(payload);
            const client = this.protocol === 'https' ? https : http;
            const opts: https.RequestOptions = {
                hostname: LOCAL_HOST,
                port: this.port,
                path: endpoint,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Connect-Protocol-Version': '1',
                    'X-Codeium-Csrf-Token': this.token,
                },
                // 本地 language server 使用自签名证书；连接固定 127.0.0.1。
                rejectUnauthorized: false,
                timeout: TIMING.HTTP_TIMEOUT_MS,
                agent: false, // 绕过代理，直接连接 loopback
            };

            const req = client.request(opts, res => {
                const chunks: Buffer[] = [];
                let received = 0;

                res.on('data', (chunk: Buffer) => {
                    received += chunk.length;
                    if (received > TIMING.MAX_RESPONSE_BYTES) {
                        logger.error('[QuotaClient] Response exceeded size limit, aborting');
                        req.destroy();
                        reject(new ConnectionError('Signal Corrupted: response too large'));
                        return;
                    }
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    if (!body.trim()) {
                        reject(new ConnectionError('Signal Corrupted: Empty response from server'));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body) as T);
                    } catch (e) {
                        const error = e instanceof Error ? e : new Error(String(e));
                        reject(new ConnectionError(`Signal Corrupted: ${error.message}`));
                    }
                });

                res.on('error', (e: Error) => reject(new ConnectionError(`Connection Failed: ${e.message}`)));
            });

            req.on('error', (e: Error) => reject(new ConnectionError(`Connection Failed: ${e.message}`)));
            req.on('timeout', () => {
                req.destroy();
                reject(new ConnectionError('Signal Lost: Request timed out'));
            });

            req.write(data);
            req.end();
        });
    }

    /** 把服务端响应解码为配额快照（静态，便于单测） */
    static decode(
        data: ServerUserStatusResponse,
        summaryData?: ServerUserQuotaSummaryResponse,
    ): QuotaSnapshot {
        if (!data || !data.userStatus) {
            if (data && typeof data.message === 'string') {
                throw new AntigravityError(t('error.serverError', { message: data.message }));
            }
            const details = data ? JSON.stringify(data).substring(0, 100) : 'empty response';
            throw new ConnectionError(t('error.invalidResponse', { details }));
        }

        const status = data.userStatus;
        const plan = status.planStatus?.planInfo;
        const credits = status.planStatus?.availablePromptCredits;

        const promptCredits = LocalQuotaClient.buildPromptCredits(plan?.monthlyPromptCredits, credits);

        const userInfo: UserInfo = {
            name: typeof status.name === 'string' ? status.name : 'Unknown User',
            email: typeof status.email === 'string' ? status.email : 'N/A',
            planName: typeof plan?.planName === 'string' ? plan.planName : 'N/A',
            tier: status.userTier?.name || (typeof plan?.teamsTier === 'string' ? plan.teamsTier : 'N/A'),
            tierDescription: status.userTier?.description || 'N/A',
            monthlyPromptCredits: LocalQuotaClient.toFiniteNumber(plan?.monthlyPromptCredits, 0),
            availablePromptCredits: LocalQuotaClient.toFiniteNumber(status.planStatus?.availablePromptCredits, 0),
        };

        const configs = status.cascadeModelConfigData?.clientModelConfigs;
        const modelSorts = status.cascadeModelConfigData?.clientModelSorts;
        const models = LocalQuotaClient.buildModels(Array.isArray(configs) ? configs : [], modelSorts);
        const groups = LocalQuotaClient.buildGroups(summaryData, models);

        return {
            timestamp: new Date(),
            promptCredits,
            userInfo,
            models,
            groups,
            isConnected: true,
        };
    }

    private static buildGroups(
        summaryData: ServerUserQuotaSummaryResponse | undefined,
        models: ModelQuotaInfo[],
    ): QuotaGroupInfo[] {
        const rawGroups = summaryData?.response?.groups;
        if (Array.isArray(rawGroups) && rawGroups.length > 0) {
            return rawGroups.map(rawGroup => {
                const displayName = typeof rawGroup.displayName === 'string' && rawGroup.displayName.trim()
                    ? rawGroup.displayName.trim()
                    : 'Unknown Group';

                const lowerName = displayName.toLowerCase();
                let groupId = 'other';
                if (lowerName.includes('gemini')) {
                    groupId = 'gemini';
                } else if (lowerName.includes('claude') || lowerName.includes('gpt')) {
                    groupId = 'claude_gpt';
                } else {
                    groupId = lowerName.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'group';
                }

                const buckets: QuotaBucketInfo[] = [];
                if (Array.isArray(rawGroup.buckets)) {
                    for (const rawBucket of rawGroup.buckets) {
                        if (!rawBucket || typeof rawBucket !== 'object') {
                            continue;
                        }
                        const bucketId = typeof rawBucket.bucketId === 'string' ? rawBucket.bucketId : 'unknown';
                        const bucketName = typeof rawBucket.displayName === 'string' && rawBucket.displayName.trim()
                            ? rawBucket.displayName.trim()
                            : bucketId;
                        const window = typeof rawBucket.window === 'string' ? rawBucket.window : (bucketId.includes('5h') ? '5h' : 'weekly');

                        const remainingFraction = typeof rawBucket.remainingFraction === 'number'
                            && Number.isFinite(rawBucket.remainingFraction)
                            ? Math.min(1, Math.max(0, rawBucket.remainingFraction))
                            : undefined;

                        const now = new Date();
                        let reset = rawBucket.resetTime ? new Date(rawBucket.resetTime) : new Date(NaN);
                        let resetTimeValid = true;
                        if (Number.isNaN(reset.getTime())) {
                            reset = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                            resetTimeValid = false;
                        }
                        const delta = reset.getTime() - now.getTime();

                        buckets.push({
                            bucketId,
                            displayName: bucketName,
                            description: typeof rawBucket.description === 'string' ? rawBucket.description : undefined,
                            window,
                            remainingFraction,
                            remainingPercentage: remainingFraction !== undefined ? remainingFraction * 100 : undefined,
                            resetTime: reset,
                            resetTimeDisplay: resetTimeValid ? formatIso(reset) : t('common.unknown'),
                            timeUntilReset: delta,
                            timeUntilResetFormatted: resetTimeValid ? formatDelta(delta) : t('common.unknown'),
                            resetTimeValid,
                        });
                    }
                }

                let lowestBucket: QuotaBucketInfo | undefined;
                for (const b of buckets) {
                    if (b.remainingPercentage !== undefined) {
                        if (!lowestBucket || (lowestBucket.remainingPercentage ?? 101) > b.remainingPercentage) {
                            lowestBucket = b;
                        }
                    }
                }

                const matchedModels = models.filter(m => {
                    const idOrLabel = `${m.modelId} ${m.label}`.toLowerCase();
                    if (groupId === 'gemini') {
                        return idOrLabel.includes('gemini');
                    }
                    if (groupId === 'claude_gpt') {
                        return idOrLabel.includes('claude') || idOrLabel.includes('gpt');
                    }
                    return false;
                });

                return {
                    groupId,
                    displayName,
                    description: typeof rawGroup.description === 'string' ? rawGroup.description : undefined,
                    buckets,
                    lowestBucket,
                    models: matchedModels,
                };
            });
        }

        return LocalQuotaClient.buildFallbackGroups(models);
    }

    private static buildFallbackGroups(models: ModelQuotaInfo[]): QuotaGroupInfo[] {
        const geminiModels = models.filter(m => `${m.modelId} ${m.label}`.toLowerCase().includes('gemini'));
        const claudeGptModels = models.filter(m => {
            const s = `${m.modelId} ${m.label}`.toLowerCase();
            return s.includes('claude') || s.includes('gpt');
        });

        const makeFallbackGroup = (
            groupId: string,
            displayName: string,
            groupModels: ModelQuotaInfo[],
        ): QuotaGroupInfo => {
            let lowestModel = groupModels[0];
            for (const m of groupModels) {
                if ((m.remainingPercentage ?? 100) < (lowestModel?.remainingPercentage ?? 100)) {
                    lowestModel = m;
                }
            }

            const fallbackBucket: QuotaBucketInfo | undefined = lowestModel ? {
                bucketId: `${groupId}-active`,
                displayName: 'Active Limit',
                window: 'active',
                remainingFraction: lowestModel.remainingFraction,
                remainingPercentage: lowestModel.remainingPercentage,
                resetTime: lowestModel.resetTime,
                timeUntilReset: lowestModel.timeUntilReset,
                timeUntilResetFormatted: lowestModel.timeUntilResetFormatted,
                resetTimeDisplay: lowestModel.resetTimeDisplay,
                resetTimeValid: lowestModel.resetTimeValid,
            } : undefined;

            return {
                groupId,
                displayName,
                buckets: fallbackBucket ? [fallbackBucket] : [],
                lowestBucket: fallbackBucket,
                models: groupModels,
            };
        };

        const groups: QuotaGroupInfo[] = [];
        if (geminiModels.length > 0) {
            groups.push(makeFallbackGroup('gemini', 'Gemini Models', geminiModels));
        }
        if (claudeGptModels.length > 0) {
            groups.push(makeFallbackGroup('claude_gpt', 'Claude and GPT models', claudeGptModels));
        }
        return groups;
    }

    private static buildPromptCredits(monthlyPromptCredits: unknown, availableCredits: unknown): PromptCreditsInfo | undefined {
        if (availableCredits === undefined) {
            return undefined;
        }
        const monthlyLimit = LocalQuotaClient.toFiniteNumber(monthlyPromptCredits, 0);
        const availableVal = LocalQuotaClient.toFiniteNumber(availableCredits, 0);
        if (monthlyLimit <= 0) {
            return undefined;
        }
        return {
            available: availableVal,
            monthly: monthlyLimit,
            usedPercentage: ((monthlyLimit - availableVal) / monthlyLimit) * 100,
            remainingPercentage: (availableVal / monthlyLimit) * 100,
        };
    }

    private static buildModels(
        configs: ClientModelConfig[],
        modelSorts: ClientModelSort[] | undefined,
    ): ModelQuotaInfo[] {
        const sortOrderMap = new Map<string, number>();
        const primarySort = Array.isArray(modelSorts) ? modelSorts[0] : undefined;
        if (primarySort && Array.isArray(primarySort.groups)) {
            let index = 0;
            for (const group of primarySort.groups) {
                const labels = Array.isArray(group?.modelLabels) ? group.modelLabels : [];
                for (const label of labels) {
                    if (typeof label === 'string') {
                        sortOrderMap.set(label, index++);
                    }
                }
            }
        }

        const models: ModelQuotaInfo[] = [];
        for (const config of configs) {
            const quotaInfo = config?.quotaInfo;
            if (!quotaInfo || typeof config?.label !== 'string') {
                continue;
            }

            const now = new Date();
            let reset = new Date(quotaInfo.resetTime);
            let resetTimeValid = true;
            if (Number.isNaN(reset.getTime())) {
                reset = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                resetTimeValid = false;
            }
            const delta = reset.getTime() - now.getTime();

            const remainingFraction = typeof quotaInfo.remainingFraction === 'number'
                && Number.isFinite(quotaInfo.remainingFraction)
                ? Math.min(1, Math.max(0, quotaInfo.remainingFraction))
                : undefined;

            const modelId = typeof config.modelOrAlias?.model === 'string' && config.modelOrAlias.model
                ? config.modelOrAlias.model
                : 'unknown';

            models.push({
                label: config.label,
                modelId,
                remainingFraction,
                remainingPercentage: remainingFraction !== undefined ? remainingFraction * 100 : undefined,
                isExhausted: remainingFraction === 0,
                resetTime: reset,
                resetTimeDisplay: resetTimeValid ? formatIso(reset) : t('common.unknown'),
                timeUntilReset: delta,
                timeUntilResetFormatted: resetTimeValid ? formatDelta(delta) : t('common.unknown'),
                resetTimeValid,
                supportsImages: config.supportsImages === true,
                isRecommended: config.isRecommended === true,
                tagTitle: typeof config.tagTitle === 'string' ? config.tagTitle : undefined,
            });
        }

        models.sort((a, b) => {
            const indexA = sortOrderMap.get(a.label);
            const indexB = sortOrderMap.get(b.label);
            if (indexA !== undefined && indexB !== undefined) {
                return indexA - indexB;
            }
            if (indexA !== undefined) {
                return -1;
            }
            if (indexB !== undefined) {
                return 1;
            }
            return a.label.localeCompare(b.label);
        });

        return models;
    }

    private static toFiniteNumber(value: unknown, fallback: number): number {
        const num = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(num) ? num : fallback;
    }
}

/** 空/离线快照 */
export function createOfflineSnapshot(errorMessage?: string): QuotaSnapshot {
    return {
        timestamp: new Date(),
        models: [],
        groups: [],
        isConnected: false,
        errorMessage,
    };
}

/** 配额健康等级判定 */
export function resolveQuotaLevel(
    percentage: number,
    warningThreshold: number = QUOTA_THRESHOLDS.WARNING_DEFAULT,
    criticalThreshold: number = QUOTA_THRESHOLDS.CRITICAL_DEFAULT,
): 'healthy' | 'warning' | 'critical' {
    if (percentage <= criticalThreshold) {
        return 'critical';
    }
    if (percentage <= warningThreshold) {
        return 'warning';
    }
    return 'healthy';
}

function formatIso(date: Date): string {
    const dateStr = date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const timeStr = date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    return `${dateStr} ${timeStr}`;
}

function formatDelta(ms: number): string {
    if (ms <= 0) {
        return t('common.now');
    }
    const totalMinutes = Math.ceil(ms / 60000);
    if (totalMinutes < 60) {
        return `${totalMinutes}m`;
    }
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    if (totalHours < 24) {
        return `${totalHours}h ${remainingMinutes}m`;
    }
    const days = Math.floor(totalHours / 24);
    const remainingHours = totalHours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
}
