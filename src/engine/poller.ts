/**
 * antigravityQuota - 轮询调度器
 *
 * 可靠性 / 风控加固（对应 docs/隐患.md 二.4 高频轮询）：
 *  - 间隔硬下限 60s，上限 1h；
 *  - 每次调度叠加 ±10% 抖动，避免多实例/多窗口同步打点；
 *  - 连续失败时指数退避，成功后立即回落；
 *  - 单飞（single-flight）保证同一时刻只有一个请求在跑。
 */

import { TIMING } from '../shared/constants';
import { clampRefreshIntervalMs, withJitter } from '../shared/env_guard';
import { logger } from '../shared/log_service';

export interface QuotaPollerCallbacks {
    /** 执行一次拉取；返回 true 表示成功 */
    onTick: () => Promise<boolean>;
    /** 已安排下一次调度（用于 UI 显示） */
    onSchedule?: (delayMs: number) => void;
}

export class QuotaPoller {
    private timer?: ReturnType<typeof setTimeout>;
    private stopped = true;
    private baseIntervalMs: number = TIMING.DEFAULT_REFRESH_INTERVAL_MS;
    private consecutiveFailures = 0;
    private ticking = false;

    constructor(private readonly callbacks: QuotaPollerCallbacks) {}

    start(intervalMs: number): void {
        this.baseIntervalMs = clampRefreshIntervalMs(intervalMs);
        this.consecutiveFailures = 0;
        this.stopped = false;
        logger.info(`[Poller] Started with base interval ${this.baseIntervalMs}ms`);
        this.schedule(this.baseIntervalMs);
    }

    /** 更新间隔（配置变更时调用） */
    updateInterval(intervalMs: number): void {
        const next = clampRefreshIntervalMs(intervalMs);
        if (next === this.baseIntervalMs) {
            return;
        }
        this.baseIntervalMs = next;
        logger.info(`[Poller] Interval changed to ${next}ms`);
        if (!this.stopped && !this.ticking) {
            this.clearTimer();
            this.schedule(this.backoffDelayMs());
        }
    }

    stop(): void {
        this.stopped = true;
        this.clearTimer();
        logger.info('[Poller] Stopped');
    }

    isRunning(): boolean {
        return !this.stopped;
    }

    /** 立即执行一次（手动刷新）。失败不影响既有调度。 */
    async triggerNow(): Promise<boolean> {
        return this.tick({ fromManual: true });
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private backoffDelayMs(): number {
        if (this.consecutiveFailures <= 0) {
            return this.baseIntervalMs;
        }
        const exponential = this.baseIntervalMs * Math.pow(2, this.consecutiveFailures);
        return Math.min(exponential, TIMING.MAX_BACKOFF_MS);
    }

    private schedule(delayMs: number): void {
        if (this.stopped) {
            return;
        }
        const jittered = withJitter(delayMs);
        this.clearTimer();
        this.timer = setTimeout(() => {
            void this.tick({ fromManual: false });
        }, jittered);
        this.timer.unref?.();
        this.callbacks.onSchedule?.(jittered);
        logger.debug(`[Poller] Next tick in ${jittered}ms (failures=${this.consecutiveFailures})`);
    }

    private async tick(options: { fromManual: boolean }): Promise<boolean> {
        if (this.ticking) {
            logger.debug('[Poller] Tick skipped (already in flight)');
            return false;
        }

        this.ticking = true;
        let success = false;
        try {
            success = await this.callbacks.onTick();
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            logger.error(`[Poller] Tick threw: ${error.message}`);
            success = false;
        } finally {
            this.ticking = false;
        }

        if (success) {
            this.consecutiveFailures = 0;
        } else if (!options.fromManual) {
            this.consecutiveFailures++;
        }

        if (!this.stopped) {
            this.schedule(this.backoffDelayMs());
        }

        return success;
    }
}
