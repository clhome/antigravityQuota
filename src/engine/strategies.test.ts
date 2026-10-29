import { WindowsStrategy, UnixStrategy } from './strategies';

describe('Process Detection Strategies', () => {
    describe('WindowsStrategy', () => {
        const strategy = new WindowsStrategy();
        
        // Access private method for testing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isAntigravityProcess = (strategy as any).isAntigravityProcess.bind(strategy);

        it('should identify a valid Antigravity process', () => {
            const cmd = 'C:\\Path\\to\\language_server.exe --extension_server_port 53125 --csrf_token abc-123 --app_data_dir antigravity';
            expect(isAntigravityProcess(cmd)).toBe(true);
        });

        it('should identify a new-version agy.exe process with --hub-port and equals', () => {
            const cmd = 'C:\\Users\\user\\.gemini\\bin\\agy.exe --hub --hub-port=54364 --app_data_dir=antigravity --csrf_token=2c23fbdd-de82-49f8-ae11-9904c7a49504';
            expect(isAntigravityProcess(cmd)).toBe(true);

            const parsed = strategy.parseProcessInfo(JSON.stringify([{
                ProcessId: 12248,
                CommandLine: cmd,
            }]));
            expect(parsed).toEqual([{
                pid: 12248,
                extensionPort: 54364,
                csrfToken: '2c23fbdd-de82-49f8-ae11-9904c7a49504',
            }]);
        });

        it('should reject process missing extension_server_port', () => {
            const cmd = 'C:\\Path\\to\\language_server.exe --csrf_token abc-123 --app_data_dir antigravity';
            expect(isAntigravityProcess(cmd)).toBe(false);
        });

        it('should reject process missing csrf_token', () => {
            const cmd = 'C:\\Path\\to\\language_server.exe --extension_server_port 53125 --app_data_dir antigravity';
            expect(isAntigravityProcess(cmd)).toBe(false);
        });

        it('should reject process missing app_data_dir antigravity', () => {
            const cmd = 'C:\\Path\\to\\language_server.exe --extension_server_port 53125 --csrf_token abc-123 --app_data_dir something_else';
            expect(isAntigravityProcess(cmd)).toBe(false);
        });
    });

    describe('UnixStrategy', () => {
        const strategy = new UnixStrategy('darwin');
        
        // Access private method for testing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const isAntigravityProcess = (strategy as any).isAntigravityProcess.bind(strategy);

        it('should identify a valid Antigravity process on Unix', () => {
            const cmd = '/path/to/language_server --extension_server_port=53125 --csrf_token=abc-123 --app_data_dir antigravity';
            expect(isAntigravityProcess(cmd)).toBe(true);
        });

        it('should handle different space/equals formats', () => {
            const cmd = '/path/to/language_server --extension_server_port 53125 --csrf_token abc-123 --app_data_dir antigravity';
            expect(isAntigravityProcess(cmd)).toBe(true);
        });

        it('should identify a new-version agy process with --hub-port on Unix', () => {
            const cmd = '/home/user/.gemini/bin/agy --hub --hub-port=54364 --app_data_dir=antigravity --csrf_token=abc-123';
            expect(isAntigravityProcess(cmd)).toBe(true);

            const stdout = `12248 1000 ${cmd}`;
            const parsed = strategy.parseProcessInfo(stdout);
            expect(parsed).toEqual([{
                pid: 12248,
                extensionPort: 54364,
                csrfToken: 'abc-123',
            }]);
        });

        it('should reject invalid app_data_dir', () => {
            const cmd = '/path/to/language_server --extension_server_port 53125 --csrf_token abc-123 --app_data_dir=wrong';
            expect(isAntigravityProcess(cmd)).toBe(false);
        });
    });

    describe('command injection hardening', () => {
        const win = new WindowsStrategy();
        const unix = new UnixStrategy('linux');

        it('refuses to build a process command from an unknown process name', () => {
            expect(() => win.getProcessListCommand('evil; rm -rf /')).toThrow(/unknown process name/i);
            expect(() => unix.getProcessListCommand('$(whoami)')).toThrow(/unknown process name/i);
            expect(() => win.getProcessListCommand('')).toThrow(/unknown process name/i);
        });

        it('accepts only whitelisted process names', () => {
            expect(win.getProcessListCommand('language_server_windows_x64.exe'))
                .toContain('language_server_windows_x64.exe');
            expect(win.getProcessListCommand('agy.exe'))
                .toContain('agy.exe');
            expect(unix.getProcessListCommand('agy'))
                .toContain('agy');
        });

        it('refuses to build a port command from an invalid pid', () => {
            for (const pid of [0, -1, 1.5, 0x80000000, Number.NaN]) {
                expect(() => win.getPortListCommand(pid)).toThrow(/invalid pid/i);
                expect(() => unix.getPortListCommand(pid)).toThrow(/invalid pid/i);
            }
        });

        it('rejects candidates carrying a malformed csrf token', () => {
            const stdout = JSON.stringify([{
                ProcessId: 1234,
                CommandLine: 'language_server.exe --extension_server_port 53125 --csrf_token "a;b" --app_data_dir antigravity',
            }]);
            expect(win.parseProcessInfo(stdout)).toEqual([]);
        });

        it('rejects oversized process output', () => {
            expect(win.parseProcessInfo('x'.repeat(5 * 1024 * 1024))).toEqual([]);
            expect(unix.parseProcessInfo('x'.repeat(5 * 1024 * 1024))).toEqual([]);
        });

        it('never emits an out-of-range port from parsing', () => {
            expect(win.parseListeningPorts('80\n65535\n70000\n0')).toEqual([80, 65535]);
            expect(unix.parseListeningPorts('TCP *:53125 (LISTEN)')).toEqual([53125]);
        });

        it('drops unparseable unix candidates instead of throwing', () => {
            expect(unix.parseProcessInfo('not a ps line')).toEqual([]);
        });
    });
});
