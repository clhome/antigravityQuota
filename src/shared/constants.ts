/**
 * antigravityQuota - 常量定义
 * 仅保留最小配额查看所需的常量。
 */

/** 配额健康度阈值（百分比） */
export const QUOTA_THRESHOLDS = {
    /** 健康状态阈值 (> 50%) */
    HEALTHY: 50,
    /** 警告状态默认阈值 (> 30%) - 黄色 */
    WARNING_DEFAULT: 30,
    /** 危险状态默认阈值 (<= 10%) - 红色 */
    CRITICAL_DEFAULT: 10,
} as const;

/** 时间相关常量（毫秒） */
export const TIMING = {
    /** 默认刷新间隔（5 分钟，降低对非公开接口的请求频率） */
    DEFAULT_REFRESH_INTERVAL_MS: 300_000,
    /** 最小允许刷新间隔（60 秒，硬下限，防止高频轮询） */
    MIN_REFRESH_INTERVAL_MS: 60_000,
    /** 最大允许刷新间隔（1 小时） */
    MAX_REFRESH_INTERVAL_MS: 3_600_000,
    /** 刷新抖动比例（±10%，避免多实例同步打点） */
    JITTER_RATIO: 0.1,
    /** HTTP 请求超时 */
    HTTP_TIMEOUT_MS: 15_000,
    /** 进程命令执行超时（兼容 Windows PowerShell 冷启动） */
    PROCESS_CMD_TIMEOUT_MS: 15_000,
    /** 手动刷新冷却时间 */
    REFRESH_COOLDOWN_MS: 60_000,
    /** 失败退避上限（30 分钟） */
    MAX_BACKOFF_MS: 30 * 60 * 1000,
    /** 单次响应的最大字节数（防御异常/恶意超长响应） */
    MAX_RESPONSE_BYTES: 4 * 1024 * 1024,
    /** 进程命令输出的最大字节数 */
    MAX_COMMAND_OUTPUT_BYTES: 4 * 1024 * 1024,
    /** 连接失败后的自动重试次数与间隔 */
    CONNECT_MAX_RETRY: 3,
    CONNECT_RETRY_DELAY_MS: 5_000,
} as const;

/** 本地 language server 端点 */
export const API_ENDPOINTS = {
    GET_USER_STATUS: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
    GET_UNLEASH_DATA: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
    RETRIEVE_USER_QUOTA_SUMMARY: '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
} as const;

/** 目标进程名称映射（白名单，禁止外部值拼入命令） */
export const PROCESS_NAMES = {
    windows: 'agy.exe',
    windows_legacy: 'language_server_windows_x64.exe',
    darwin_arm: 'agy',
    darwin_arm_legacy: 'language_server_macos_arm',
    darwin_x64: 'agy',
    darwin_x64_legacy: 'language_server_macos',
    linux: 'agy',
    linux_legacy: 'language_server_linux',
} as const;

/** 各平台优先探测的主候选进程名与回落候选进程名列表 */
export const PLATFORM_PROCESS_CANDIDATES: Record<'win32' | 'darwin' | 'linux', readonly string[]> = {
    win32: ['agy.exe', 'language_server_windows_x64.exe'],
    darwin: ['agy', 'language_server_macos_arm', 'language_server_macos'],
    linux: ['agy', 'language_server_linux'],
};

/** 允许的进程名白名单 */
export const ALLOWED_PROCESS_NAMES: ReadonlySet<string> = new Set<string>([
    ...Object.values(PROCESS_NAMES),
    'agy.exe',
    'agy',
    'language_server_windows_x64.exe',
    'language_server_macos_arm',
    'language_server_macos',
    'language_server_linux',
]);

/** 配置键名 */
export const CONFIG_KEYS = {
    REFRESH_INTERVAL: 'refreshInterval',
    LOG_LEVEL: 'logLevel',
    NOTIFICATION_ENABLED: 'notificationEnabled',
    STATUS_BAR_FORMAT: 'statusBarFormat',
    WARNING_THRESHOLD: 'warningThreshold',
    CRITICAL_THRESHOLD: 'criticalThreshold',
    DATA_MASKED: 'dataMasked',
    LANGUAGE: 'language',
} as const;

/** 状态栏显示格式 */
export const STATUS_BAR_FORMAT = {
    ICON: 'icon',
    DOT: 'dot',
    PERCENT: 'percent',
    COMPACT: 'compact',
    NAME_PERCENT: 'namePercent',
    STANDARD: 'standard',
} as const;

/** 日志级别 */
export const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
} as const;

/**
 * 扩展标识。
 * 与 package.json 的 `name` 保持一致，同时作为命令与配置的命名空间前缀，
 * 避免命名空间散落在各处（命令 ID / 配置键 / 输出通道）。
 */
export const EXTENSION_ID = 'antigravityQuota';

/** 配置命名空间 */
export const CONFIG_SECTION = EXTENSION_ID;

/** UI 相关常量 */
export const UI = {
    /** 状态栏优先级 */
    STATUS_BAR_PRIORITY: 100,
} as const;

/** 命令 ID */
export const COMMANDS = {
    OPEN: `${EXTENSION_ID}.open`,
    REFRESH: `${EXTENSION_ID}.refresh`,
    SHOW_LOGS: `${EXTENSION_ID}.showLogs`,
    PURGE_LEGACY: `${EXTENSION_ID}.purgeLegacyData`,
} as const;

/** 日志/输出通道名称 */
export const OUTPUT_CHANNEL_NAME = EXTENSION_ID;

/** 官方项目主页与出品信息 */
export const PROJECT_METADATA = {
    PRODUCER: '衢州御风科技有限公司出品',
    REPO_URL: 'https://github.com/clhome/antigravityQuota',
} as const;
