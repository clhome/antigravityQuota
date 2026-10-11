/**
 * 本地配额解析安全回归测试
 *
 * 覆盖：字段类型/范围校验、坏数据降级、服务端报错与连接错误的区分、
 * 离线快照、配额健康等级。
 */

import { LocalQuotaClient, createOfflineSnapshot, resolveQuotaLevel } from './quota_client';
import { AntigravityError, ConnectionError } from '../shared/errors';
import { ServerUserStatusResponse } from '../shared/types';

function validResponse(): ServerUserStatusResponse {
    return {
        userStatus: {
            name: 'Alice',
            email: 'alice@example.com',
            planStatus: {
                planInfo: { planName: 'Pro', teamsTier: 'TEAM', monthlyPromptCredits: 1000 },
                availablePromptCredits: 250,
            },
            userTier: { name: 'Tier X', description: 'desc' },
            cascadeModelConfigData: {
                clientModelConfigs: [
                    {
                        label: 'Gemini 3 Pro (high)',
                        modelOrAlias: { model: 'gemini-3-pro-high' },
                        quotaInfo: { remainingFraction: 0.42, resetTime: '2999-01-01T00:00:00Z' },
                        supportsImages: true,
                        isRecommended: true,
                    },
                    {
                        label: 'Claude Sonnet',
                        modelOrAlias: { model: 'claude-4-5-sonnet' },
                        quotaInfo: { remainingFraction: 0, resetTime: '2999-01-01T00:00:00Z' },
                    },
                ],
                clientModelSorts: [
                    { name: 'Recommended', groups: [{ modelLabels: ['Claude Sonnet', 'Gemini 3 Pro (high)'] }] },
                ],
            },
        },
    };
}

describe('LocalQuotaClient.decode', () => {
    it('parses a well-formed response', () => {
        const snapshot = LocalQuotaClient.decode(validResponse());

        expect(snapshot.isConnected).toBe(true);
        expect(snapshot.models).toHaveLength(2);
        expect(snapshot.userInfo?.email).toBe('alice@example.com');
        expect(snapshot.promptCredits?.available).toBe(250);
        expect(snapshot.promptCredits?.monthly).toBe(1000);
    });

    it('honours the server-provided model sort order', () => {
        const snapshot = LocalQuotaClient.decode(validResponse());
        expect(snapshot.models.map(m => m.label)).toEqual(['Claude Sonnet', 'Gemini 3 Pro (high)']);
    });

    it('clamps remainingFraction into [0, 1]', () => {
        const response = validResponse();
        response.userStatus!.cascadeModelConfigData!.clientModelConfigs[0].quotaInfo!.remainingFraction = 42;
        response.userStatus!.cascadeModelConfigData!.clientModelConfigs[1].quotaInfo!.remainingFraction = -3;

        const snapshot = LocalQuotaClient.decode(response);
        expect(snapshot.models[1].remainingFraction).toBe(1);
        expect(snapshot.models[0].remainingFraction).toBe(0);
    });

    it('flags non-numeric and NaN remainingFraction as unknown', () => {
        const response = validResponse();
        const configs = response.userStatus!.cascadeModelConfigData!.clientModelConfigs;
        configs[0].quotaInfo!.remainingFraction = Number.NaN;
        (configs[1].quotaInfo as unknown as Record<string, unknown>).remainingFraction = '0.5';

        const snapshot = LocalQuotaClient.decode(response);
        expect(snapshot.models[0].remainingFraction).toBeUndefined();
        expect(snapshot.models[0].remainingPercentage).toBeUndefined();
        expect(snapshot.models[1].remainingFraction).toBeUndefined();
    });

    it('falls back to a 24h window when resetTime is invalid', () => {
        const response = validResponse();
        response.userStatus!.cascadeModelConfigData!.clientModelConfigs[0].quotaInfo!.resetTime = 'not-a-date';

        const snapshot = LocalQuotaClient.decode(response);
        const model = snapshot.models.find(m => m.label === 'Gemini 3 Pro (high)')!;
        expect(model.resetTimeValid).toBe(false);
        expect(model.timeUntilReset).toBeGreaterThan(0);
    });

    it('skips configs without quotaInfo or label', () => {
        const response = validResponse();
        const configs = response.userStatus!.cascadeModelConfigData!.clientModelConfigs as unknown[];
        configs.push({ label: 'No quota', modelOrAlias: { model: 'x' } });
        configs.push({ quotaInfo: { remainingFraction: 1, resetTime: '2999-01-01T00:00:00Z' } });

        const snapshot = LocalQuotaClient.decode(response);
        expect(snapshot.models).toHaveLength(2);
    });

    it('throws AntigravityError when the server reports a message', () => {
        expect(() => LocalQuotaClient.decode({ message: 'boom' })).toThrow(AntigravityError);
    });

    it('throws ConnectionError when the payload shape is unexpected', () => {
        expect(() => LocalQuotaClient.decode({})).toThrow(ConnectionError);
        expect(() => LocalQuotaClient.decode(undefined as unknown as ServerUserStatusResponse))
            .toThrow(ConnectionError);
    });

    it('never emits an unclamped percentage', () => {
        const response = validResponse();
        response.userStatus!.cascadeModelConfigData!.clientModelConfigs[0].quotaInfo!.remainingFraction = 9;

        const snapshot = LocalQuotaClient.decode(response);
        for (const model of snapshot.models) {
            if (model.remainingPercentage !== undefined) {
                expect(model.remainingPercentage).toBeGreaterThanOrEqual(0);
                expect(model.remainingPercentage).toBeLessThanOrEqual(100);
            }
        }
    });
    it('parses quota groups when summaryData is provided', () => {
        const summary = {
            response: {
                groups: [
                    {
                        displayName: 'Gemini Models',
                        description: 'Gemini desc',
                        buckets: [
                            {
                                bucketId: 'gemini-weekly',
                                displayName: 'Weekly Limit Remaining',
                                window: 'weekly',
                                remainingFraction: 0.54,
                                resetTime: '2999-01-01T00:00:00Z',
                            },
                            {
                                bucketId: 'gemini-5h',
                                displayName: 'Five Hour Limit Remaining',
                                window: '5h',
                                remainingFraction: 0.70,
                                resetTime: '2999-01-01T00:00:00Z',
                            },
                        ],
                    },
                    {
                        displayName: 'Claude and GPT models',
                        buckets: [
                            {
                                bucketId: '3p-weekly',
                                displayName: 'Weekly Limit Remaining',
                                window: 'weekly',
                                remainingFraction: 0.10,
                                resetTime: '2999-01-01T00:00:00Z',
                            },
                        ],
                    },
                ],
            },
        };

        const snapshot = LocalQuotaClient.decode(validResponse(), summary);
        expect(snapshot.groups).toHaveLength(2);

        const geminiGroup = snapshot.groups[0];
        expect(geminiGroup.groupId).toBe('gemini');
        expect(geminiGroup.buckets).toHaveLength(2);
        expect(geminiGroup.lowestBucket?.remainingPercentage).toBe(54);
        expect(geminiGroup.models.some(m => m.label.includes('Gemini'))).toBe(true);

        const claudeGroup = snapshot.groups[1];
        expect(claudeGroup.groupId).toBe('claude_gpt');
        expect(claudeGroup.lowestBucket?.remainingPercentage).toBe(10);
        expect(claudeGroup.models.some(m => m.label.includes('Claude'))).toBe(true);
    });

    it('falls back to model-derived groups when summaryData is omitted', () => {
        const snapshot = LocalQuotaClient.decode(validResponse());
        expect(snapshot.groups.length).toBeGreaterThan(0);
        expect(snapshot.groups.some(g => g.groupId === 'gemini')).toBe(true);
        expect(snapshot.groups.some(g => g.groupId === 'claude_gpt')).toBe(true);
    });
});

describe('createOfflineSnapshot', () => {
    it('returns a disconnected snapshot with the given error', () => {
        const snapshot = createOfflineSnapshot('offline!');
        expect(snapshot.isConnected).toBe(false);
        expect(snapshot.models).toEqual([]);
        expect(snapshot.groups).toEqual([]);
        expect(snapshot.errorMessage).toBe('offline!');
    });
});

describe('resolveQuotaLevel', () => {
    it('maps percentages to levels using the configured thresholds', () => {
        expect(resolveQuotaLevel(80, 30, 10)).toBe('healthy');
        expect(resolveQuotaLevel(30, 30, 10)).toBe('warning');
        expect(resolveQuotaLevel(10, 30, 10)).toBe('critical');
        expect(resolveQuotaLevel(0, 30, 10)).toBe('critical');
    });
});
