/**
 * antigravityQuota - Dashboard webview 脚本
 *
 * 安全约束：所有来自扩展/服务端的文本一律用 textContent / createTextNode 写入，
 * 不使用任何原始 HTML 注入 API，避免渲染注入。
 */
(function () {
    const vscode = acquireVsCodeApi();

    const banner = document.getElementById('banner');
    const groupsRoot = document.getElementById('groups');
    const modelsRoot = document.getElementById('models');
    const metaRoot = document.getElementById('meta');
    const updatedRoot = document.getElementById('updated');
    const localOnly = document.querySelector('.local-only');
    const producer = document.querySelector('.producer');
    const repoLink = document.getElementById('repo-link');
    const refreshBtn = document.getElementById('refresh');
    const logsBtn = document.getElementById('logs');
    const title = document.querySelector('.title');

    let strings = {};
    let lastPayload = null;

    function tr(key) {
        return strings[key] || key;
    }

    function text(value) {
        return document.createTextNode(String(value === null || value === undefined ? '' : value));
    }

    function setButtonLabel(button, key) {
        button.textContent = tr(key);
    }

    function renderMeta(payload) {
        metaRoot.textContent = '';
        if (!payload.user) {
            return;
        }
        const fields = [
            [tr('dashboard.account'), payload.user.email],
            [tr('dashboard.plan'), payload.user.planName],
            [tr('dashboard.tier'), payload.user.tier],
        ];
        for (const [label, value] of fields) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            const name = document.createElement('span');
            name.className = 'chip-label';
            name.appendChild(text(label));
            const val = document.createElement('span');
            val.className = 'chip-value';
            val.appendChild(text(value));
            chip.appendChild(name);
            chip.appendChild(val);
            metaRoot.appendChild(chip);
        }
        if (payload.promptCredits) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            const name = document.createElement('span');
            name.className = 'chip-label';
            name.appendChild(text(tr('statusBar.credits')));
            const val = document.createElement('span');
            val.className = 'chip-value';
            val.appendChild(text(
                `${Math.round(payload.promptCredits.available)} / ${Math.round(payload.promptCredits.monthly)}`
            ));
            chip.appendChild(name);
            chip.appendChild(val);
            metaRoot.appendChild(chip);
        }
    }

    function renderBanner(payload) {
        banner.textContent = '';
        banner.classList.add('hidden');
        if (payload.connected) {
            return;
        }
        banner.classList.remove('hidden');
        const heading = document.createElement('div');
        heading.className = 'banner-title';
        heading.appendChild(text(tr('dashboard.offlineTitle')));
        const desc = document.createElement('div');
        desc.className = 'banner-desc';
        desc.appendChild(text(payload.errorMessage || tr('dashboard.offlineDesc')));
        const retry = document.createElement('button');
        retry.className = 'btn';
        retry.type = 'button';
        retry.appendChild(text(tr('dashboard.retry')));
        retry.addEventListener('click', function () {
            vscode.postMessage({ type: 'retry' });
        });
        banner.appendChild(heading);
        banner.appendChild(desc);
        banner.appendChild(retry);
    }

    function renderGroups(payload) {
        groupsRoot.textContent = '';
        if (!payload.groups || payload.groups.length === 0) {
            return;
        }

        for (const group of payload.groups) {
            const card = document.createElement('div');
            card.className = 'group-card level-' + group.level;

            const head = document.createElement('div');
            head.className = 'group-head';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'group-title-wrap';

            const title = document.createElement('span');
            title.className = 'group-title';
            title.appendChild(text(group.displayName));
            titleWrap.appendChild(title);

            if (group.description) {
                const desc = document.createElement('div');
                desc.className = 'group-desc';
                desc.appendChild(text(group.description));
                titleWrap.appendChild(desc);
            }
            head.appendChild(titleWrap);
            card.appendChild(head);

            const bucketList = document.createElement('div');
            bucketList.className = 'bucket-list';

            for (const bucket of group.buckets) {
                const bRow = document.createElement('div');
                bRow.className = 'bucket-row level-' + bucket.level;

                const bInfo = document.createElement('div');
                bInfo.className = 'bucket-info';

                const bName = document.createElement('div');
                bName.className = 'bucket-name';
                bName.appendChild(text(bucket.displayName));
                bInfo.appendChild(bName);

                if (bucket.description) {
                    const bDesc = document.createElement('div');
                    bDesc.className = 'bucket-desc';
                    bDesc.appendChild(text(bucket.description));
                    bInfo.appendChild(bDesc);
                }
                bRow.appendChild(bInfo);

                const bStat = document.createElement('div');
                bStat.className = 'bucket-stat';

                const bPct = document.createElement('span');
                bPct.className = 'bucket-pct';
                bPct.appendChild(text(bucket.percentage + '%'));
                bStat.appendChild(bPct);

                const bar = document.createElement('div');
                bar.className = 'bar';
                const fill = document.createElement('div');
                fill.className = 'bar-fill';
                fill.style.width = Math.max(0, Math.min(100, bucket.percentage)) + '%';
                bar.appendChild(fill);
                bStat.appendChild(bar);

                const bReset = document.createElement('div');
                bReset.className = 'bucket-reset';
                bReset.appendChild(text(tr('dashboard.resetIn') + ': ' + bucket.resetIn));
                bStat.appendChild(bReset);

                bRow.appendChild(bStat);
                bucketList.appendChild(bRow);
            }

            card.appendChild(bucketList);
            groupsRoot.appendChild(card);
        }
    }

    function renderModels(payload) {
        modelsRoot.textContent = '';
        if (!payload.models || payload.models.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.appendChild(text(tr('dashboard.noModels')));
            modelsRoot.appendChild(empty);
            return;
        }

        for (const model of payload.models) {
            const card = document.createElement('div');
            card.className = 'card level-' + model.level;

            const head = document.createElement('div');
            head.className = 'card-head';
            const label = document.createElement('span');
            label.className = 'model-name';
            label.appendChild(text(model.label));
            head.appendChild(label);
            if (model.tagTitle) {
                const tag = document.createElement('span');
                tag.className = 'tag';
                tag.appendChild(text(model.tagTitle));
                head.appendChild(tag);
            }
            const pct = document.createElement('span');
            pct.className = 'model-pct';
            pct.appendChild(text(model.percentage + '%'));
            head.appendChild(pct);
            card.appendChild(head);

            const bar = document.createElement('div');
            bar.className = 'bar';
            const fill = document.createElement('div');
            fill.className = 'bar-fill';
            fill.style.width = Math.max(0, Math.min(100, model.percentage)) + '%';
            bar.appendChild(fill);
            card.appendChild(bar);

            const foot = document.createElement('div');
            foot.className = 'card-foot';
            const reset = document.createElement('span');
            reset.className = 'reset';
            reset.appendChild(text(tr('dashboard.resetIn') + ': ' + model.resetIn));
            const at = document.createElement('span');
            at.className = 'reset-at';
            at.appendChild(text(model.resetAt));
            foot.appendChild(reset);
            foot.appendChild(at);
            card.appendChild(foot);

            modelsRoot.appendChild(card);
        }
    }

    function render(payload) {
        if (!payload) {
            return;
        }
        lastPayload = payload;
        strings = payload.i18n || {};
        setButtonLabel(refreshBtn, 'dashboard.refresh');
        setButtonLabel(logsBtn, 'common.openLogs');
        if (title) {
            title.textContent = tr('dashboard.title');
        }
        if (localOnly) {
            localOnly.textContent = tr('dashboard.localOnly');
        }
        if (producer) {
            producer.textContent = tr('common.producer');
        }
        document.documentElement.lang = payload.locale || 'en';
        document.documentElement.dir = payload.dir === 'rtl' ? 'rtl' : 'ltr';
        renderMeta(payload);
        renderBanner(payload);
        renderGroups(payload);
        renderModels(payload);
        updatedRoot.textContent = tr('dashboard.updated') + ': ' + (payload.updatedAt || '-');
    }

    if (repoLink) {
        repoLink.addEventListener('click', function (e) {
            e.preventDefault();
            vscode.postMessage({
                type: 'openUrl',
                url: repoLink.getAttribute('href'),
            });
        });
    }

    refreshBtn.addEventListener('click', function () {
        refreshBtn.disabled = true;
        refreshBtn.textContent = tr('dashboard.refreshing');
        vscode.postMessage({ type: 'refresh' });
        setTimeout(function () {
            refreshBtn.disabled = false;
            refreshBtn.textContent = tr('dashboard.refresh');
        }, 1500);
    });

    logsBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'openLogs' });
    });

    window.addEventListener('message', function (event) {
        const message = event.data;
        if (!message || message.type !== 'render') {
            return;
        }
        render(message.payload);
    });

    vscode.postMessage({ type: 'ready' });

    window.__antigravityQuotaLastPayload = function () {
        return lastPayload;
    };
})();
