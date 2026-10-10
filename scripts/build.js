/**
 * Antigravity Cockpit (slim) - 构建脚本
 *
 * 只打包两个产物：
 *   1. out/extension.js                   扩展宿主代码
 *   2. out/view/webview/dashboard.js      Webview 脚本
 * 并复制 Webview 样式。
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const WEBVIEW_OUT_DIR = path.join(__dirname, '../out/view/webview');

async function build() {
    const isWatch = process.argv.includes('--watch');
    const isProduction = process.argv.includes('--production');

    // 1. 扩展宿主
    const extensionContext = await esbuild.context({
        entryPoints: ['./src/extension.ts'],
        bundle: true,
        external: ['vscode'],
        format: 'cjs',
        platform: 'node',
        outfile: './out/extension.js',
        sourcemap: !isProduction,
        minify: isProduction,
    });

    // 2. Webview 脚本
    const webviewContext = await esbuild.context({
        entryPoints: ['./src/view/webview/dashboard.js'],
        bundle: true,
        outfile: './out/view/webview/dashboard.js',
        minify: isProduction,
        sourcemap: !isProduction,
        target: 'es2020',
        format: 'iife',
    });

    if (isWatch) {
        await Promise.all([extensionContext.watch(), webviewContext.watch()]);
        console.log('Watching for changes...');
        return;
    }

    await Promise.all([extensionContext.rebuild(), webviewContext.rebuild()]);
    await extensionContext.dispose();
    await webviewContext.dispose();

    // 3. 复制 Webview 样式
    if (!fs.existsSync(WEBVIEW_OUT_DIR)) {
        fs.mkdirSync(WEBVIEW_OUT_DIR, { recursive: true });
    }
    fs.copyFileSync(
        './src/view/webview/dashboard.css',
        path.join(WEBVIEW_OUT_DIR, 'dashboard.css'),
    );

    console.log('Build finished successfully.');
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});
