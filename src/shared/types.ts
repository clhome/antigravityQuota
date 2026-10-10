/**
 * antigravityQuota - 类型定义
 * 仅保留配额查看与本地进程检测相关类型。
 */

// ============ 配额相关类型 ============

/** Prompt Credits 信息 */
export interface PromptCreditsInfo {
    /** 可用积分 */
    available: number;
    /** 每月配额 */
    monthly: number;
    /** 已使用百分比 */
    usedPercentage: number;
    /** 剩余百分比 */
    remainingPercentage: number;
}

/** 模型配额信息 */
export interface ModelQuotaInfo {
    /** 显示标签 */
    label: string;
    /** 模型 ID */
    modelId: string;
    /** 剩余比例 (0-1) */
    remainingFraction?: number;
    /** 剩余百分比 (0-100) */
    remainingPercentage?: number;
    /** 是否已耗尽 */
    isExhausted: boolean;
    /** 重置时间 */
    resetTime: Date;
    /** 距离重置的毫秒数 */
    timeUntilReset: number;
    /** 格式化的重置倒计时 */
    timeUntilResetFormatted: string;
    /** 格式化的重置时间显示 */
    resetTimeDisplay: string;
    /** 重置时间是否可信 */
    resetTimeValid?: boolean;
    /** 是否支持图片输入 */
    supportsImages?: boolean;
    /** 是否为推荐模型 */
    isRecommended?: boolean;
    /** 标签标题（如 "New"） */
    tagTitle?: string;
}

/** 配额快照 */
export interface QuotaSnapshot {
    /** 时间戳 */
    timestamp: Date;
    /** Prompt Credits */
    promptCredits?: PromptCreditsInfo;
    /** 用户信息 */
    userInfo?: UserInfo;
    /** 模型列表 */
    models: ModelQuotaInfo[];
    /** 连接状态 */
    isConnected: boolean;
    /** 错误信息 */
    errorMessage?: string;
}

// ============ API 响应类型 ============

/** 模型或别名 */
export interface ModelOrAlias {
    model: string;
}

/** 配额信息 */
export interface QuotaInfo {
    remainingFraction?: number;
    resetTime: string;
}

/** 客户端模型配置 */
export interface ClientModelConfig {
    label: string;
    modelOrAlias?: ModelOrAlias;
    quotaInfo?: QuotaInfo;
    supportsImages?: boolean;
    isRecommended?: boolean;
    allowedTiers?: string[];
    tagTitle?: string;
}

/** 团队配置 */
export interface DefaultTeamConfig {
    allowMcpServers?: boolean;
    allowAutoRunCommands?: boolean;
    allowBrowserExperimentalFeatures?: boolean;
    [key: string]: boolean | string | number | undefined;
}

/** 计划信息 */
export interface PlanInfo {
    teamsTier?: string;
    planName?: string;
    monthlyPromptCredits?: number;
    monthlyFlowCredits?: number;
    browserEnabled?: boolean;
    knowledgeBaseEnabled?: boolean;
    canBuyMoreCredits?: boolean;
    hasAutocompleteFastMode?: boolean;
    cascadeWebSearchEnabled?: boolean;
    canGenerateCommitMessages?: boolean;
    defaultTeamConfig?: DefaultTeamConfig;
    [key: string]: string | number | boolean | object | undefined;
}

/** 计划状态 */
export interface PlanStatus {
    planInfo?: PlanInfo;
    availablePromptCredits?: number;
    availableFlowCredits?: number;
}

/** 模型排序分组 */
export interface ModelSortGroup {
    modelLabels: string[];
}

/** 客户端模型排序 */
export interface ClientModelSort {
    name: string;
    groups: ModelSortGroup[];
}

/** Cascade 模型配置数据 */
export interface CascadeModelConfigData {
    clientModelConfigs: ClientModelConfig[];
    clientModelSorts?: ClientModelSort[];
}

/** 用户状态 */
export interface UserStatus {
    name?: string;
    email?: string;
    planStatus?: PlanStatus;
    cascadeModelConfigData?: CascadeModelConfigData;
    acceptedLatestTermsOfService?: boolean;
    userTier?: {
        name?: string;
        id?: string;
        description?: string;
        upgradeSubscriptionUri?: string;
        upgradeSubscriptionText?: string;
    };
}

/** 服务端用户状态响应 */
export interface ServerUserStatusResponse {
    userStatus?: UserStatus;
    /** 服务端返回的错误消息 */
    message?: string;
    /** 服务端返回的错误代码 */
    code?: string;
}

/** 用户详细信息（界面展示用） */
export interface UserInfo {
    name: string;
    email: string;
    planName: string;
    tier: string;
    tierDescription: string;
    monthlyPromptCredits: number;
    availablePromptCredits: number;
}

// ============ 进程检测类型 ============

/** 环境扫描结果 */
export interface EnvironmentScanResult {
    /** 扩展端口 */
    extensionPort: number;
    /** 连接端口 */
    connectPort: number;
    /** CSRF Token */
    csrfToken: string;
}

/** 扫描诊断信息 */
export interface ScanDiagnostics {
    scan_method: 'process_name' | 'keyword' | 'unknown';
    target_process: string;
    attempts: number;
    found_candidates: number;
    ports?: number[];
    verified_port?: number | null;
    verification_success?: boolean;
}

/** 进程信息 */
export interface ProcessInfo {
    /** 进程 ID */
    pid: number;
    /** 扩展端口 */
    extensionPort: number;
    /** CSRF Token */
    csrfToken: string;
}

/** 平台策略（Windows / Unix 抽象） */
export interface PlatformStrategy {
    /** 获取进程列表命令 */
    getProcessListCommand(processName: string): string;
    /** 解析进程信息 */
    parseProcessInfo(stdout: string): ProcessInfo[];
    /** 获取端口列表命令 */
    getPortListCommand(pid: number): string;
    /** 解析监听端口 */
    parseListeningPorts(stdout: string): number[];
    /** 获取诊断命令（列出所有相关进程，用于调试） */
    getDiagnosticCommand(): string;
    /** 获取错误信息 */
    getErrorMessages(): {
        processNotFound: string;
        commandNotAvailable: string;
        requirements: string[];
    };
}
