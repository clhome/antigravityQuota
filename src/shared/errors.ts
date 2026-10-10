/**
 * antigravityQuota - 错误类型
 *
 * 区分两类失败，便于决定「继续轮询」还是「重新探测进程」：
 *  - AntigravityError：服务端明确返回的错误（重试无意义，等待下一轮）
 *  - ConnectionError：连接/协议层面的失败（端口可能已变化，需要重新探测）
 */

/** 服务端明确报告的错误 */
export class AntigravityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AntigravityError';
        Object.setPrototypeOf(this, AntigravityError.prototype);
    }
}

/** 连接层面失败（超时 / 拒绝 / 空响应 / 解析失败） */
export class ConnectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConnectionError';
        Object.setPrototypeOf(this, ConnectionError.prototype);
    }
}

export function isServerError(err: unknown): err is AntigravityError {
    return err instanceof AntigravityError;
}

export function isConnectionError(err: unknown): err is ConnectionError {
    return err instanceof ConnectionError;
}
