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
