/**
 * VS Code API mock（仅覆盖本扩展用到的成员）
 */

const outputChannel = {
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
};

const statusBarItem = {
    text: '',
    tooltip: undefined as unknown,
    command: '',
    backgroundColor: undefined as unknown,
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
};

export const window = {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    createOutputChannel: jest.fn(() => outputChannel),
    createStatusBarItem: jest.fn(() => statusBarItem),
    createWebviewPanel: jest.fn(),
    activeTextEditor: undefined,
};

export const workspace = {
    getConfiguration: jest.fn(() => ({
        get: jest.fn((_key: string, fallback: unknown) => fallback),
        update: jest.fn(),
        inspect: jest.fn(),
    })),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
};

export const commands = {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
};

export const env = {
    language: 'en',
};

export class ThemeColor {
    constructor(public readonly id: string) {}
}

export class MarkdownString {
    public isTrusted = false;
    public supportHtml = false;
    private buffer = '';
    appendMarkdown(value: string): this {
        this.buffer += value;
        return this;
    }
    toString(): string {
        return this.buffer;
    }
}

export const EventEmitter = jest.fn(() => ({
    event: jest.fn(),
    fire: jest.fn(),
}));

export const Uri = {
    file: jest.fn((path: string) => ({ path })),
    parse: jest.fn((url: string) => ({ url })),
    joinPath: jest.fn((uri: { path: string }, ...parts: string[]) => ({
        path: [uri.path, ...parts].join('/'),
    })),
};

export const StatusBarAlignment = {
    Left: 1,
    Right: 2,
};

export const ViewColumn = {
    One: 1,
    Two: 2,
};

export enum ExtensionMode {
    Production = 1,
    Development = 2,
    Test = 3,
}

export default {
    window,
    workspace,
    commands,
    env,
    Uri,
    EventEmitter,
    StatusBarAlignment,
    ViewColumn,
    ThemeColor,
    MarkdownString,
    ExtensionMode,
};
