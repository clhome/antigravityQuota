/**
 * 轮询调度器安全回归测试
 *
 * 覆盖：60s 硬下限、指数退避与上限、成功后回落、single-flight、
 * 间隔动态更新。
 */

import { QuotaPoller } from './poller';
import { TIMING } from '../shared/constants';

const min = (base: number): number => Math.floor(base * (1 - TIMING.JITTER_RATIO));
const max = (base: number): number => Math.ceil(base * (1 + TIMING.JITTER_RATIO));

describe('QuotaPoller', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('never schedules faster than the 60s floor', () => {
        const delays: number[] = [];
        const poller = new QuotaPoller({
            onTick: jest.fn().mockResolvedValue(true),
            onSchedule: delay => delays.push(delay),
        });

        poller.start(5_000);

        expect(delays).toHaveLength(1);
        expect(delays[0]).toBeGreaterThanOrEqual(TIMING.MIN_REFRESH_INTERVAL_MS - 6_000);
        expect(delays[0]).toBeLessThanOrEqual(TIMING.MIN_REFRESH_INTERVAL_MS + 6_000);

        poller.stop();
    });

    it('backs off exponentially on consecutive failures', async () => {
        const delays: number[] = [];
        const onTick = jest.fn().mockResolvedValue(false);
        const poller = new QuotaPoller({ onTick, onSchedule: delay => delays.push(delay) });

        poller.start(60_000);

        await jest.advanceTimersByTimeAsync(70_000);
        expect(onTick).toHaveBeenCalledTimes(1);
        expect(delays[1]).toBeGreaterThanOrEqual(min(120_000));
        expect(delays[1]).toBeLessThanOrEqual(max(120_000));

        await jest.advanceTimersByTimeAsync(140_000);
        expect(onTick).toHaveBeenCalledTimes(2);
        expect(delays[2]).toBeGreaterThanOrEqual(min(240_000));
        expect(delays[2]).toBeLessThanOrEqual(max(240_000));

        poller.stop();
    });

    it('caps the backoff at the maximum delay', async () => {
        const delays: number[] = [];
        const poller = new QuotaPoller({
            onTick: jest.fn().mockResolvedValue(false),
            onSchedule: delay => delays.push(delay),
        });

        poller.start(60_000);
        for (let i = 0; i < 8; i++) {
            await jest.advanceTimersByTimeAsync(2_100_000);
        }

        expect(Math.max(...delays)).toBeLessThanOrEqual(max(TIMING.MAX_BACKOFF_MS));
        poller.stop();
    });

    it('resets the backoff after a success', async () => {
        const delays: number[] = [];
        const onTick = jest.fn().mockResolvedValue(false);
        const poller = new QuotaPoller({ onTick, onSchedule: delay => delays.push(delay) });

        poller.start(60_000);
        await jest.advanceTimersByTimeAsync(70_000);
        expect(delays[1]).toBeGreaterThan(min(100_000));

        onTick.mockResolvedValue(true);
        await jest.advanceTimersByTimeAsync(140_000);
        expect(delays[2]).toBeGreaterThanOrEqual(min(60_000));
        expect(delays[2]).toBeLessThanOrEqual(max(60_000));

        poller.stop();
    });

    it('is single-flight while a tick is in flight', async () => {
        let resolveTick: (value: boolean) => void = () => undefined;
        const onTick = jest.fn(() => new Promise<boolean>(resolve => {
            resolveTick = resolve;
        }));
        const poller = new QuotaPoller({ onTick });

        const first = poller.triggerNow();
        const second = await poller.triggerNow();
        expect(second).toBe(false);
        expect(onTick).toHaveBeenCalledTimes(1);

        resolveTick(true);
        await expect(first).resolves.toBe(true);

        poller.stop();
    });

    it('clamps a hostile interval on update', () => {
        const delays: number[] = [];
        const poller = new QuotaPoller({
            onTick: jest.fn().mockResolvedValue(true),
            onSchedule: delay => delays.push(delay),
        });

        poller.start(120_000);
        delays.length = 0;
        poller.updateInterval(1);

        expect(delays).toHaveLength(1);
        expect(delays[0]).toBeGreaterThanOrEqual(min(TIMING.MIN_REFRESH_INTERVAL_MS));
        expect(delays[0]).toBeLessThanOrEqual(max(TIMING.MIN_REFRESH_INTERVAL_MS));

        poller.stop();
    });

    it('stops scheduling after stop()', async () => {
        const onTick = jest.fn().mockResolvedValue(true);
        const poller = new QuotaPoller({ onTick });

        poller.start(60_000);
        poller.stop();
        await jest.advanceTimersByTimeAsync(5 * 60_000);

        expect(onTick).not.toHaveBeenCalled();
        expect(poller.isRunning()).toBe(false);
    });

    it('treats a throwing tick as failure without crashing the poller', async () => {
        const onTick = jest.fn().mockRejectedValue(new Error('boom'));
        const poller = new QuotaPoller({ onTick });

        poller.start(60_000);
        await jest.advanceTimersByTimeAsync(70_000);

        expect(onTick).toHaveBeenCalledTimes(1);
        expect(poller.isRunning()).toBe(true);

        poller.stop();
    });
});
