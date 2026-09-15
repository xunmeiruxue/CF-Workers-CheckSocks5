/**
 * 注入到上游页面的客户端脚本。
 *
 * 上游页面自己不知道订阅功能，所以这里全部用 DOM 操作完成：
 * 在控制面板里插一个订阅输入框，抓取到节点后填进上游的输入框并触发上游的检测按钮，
 * 从而复用上游已有的解析、并发、结果渲染、导出等全部逻辑。
 */

export const CLIENT_SCRIPT = String.raw`
(function () {
	'use strict';

	if (window.__lcsSubscriptionReady) return;
	window.__lcsSubscriptionReady = true;

	var API_PATH = '/subfetch';
	var STORAGE_KEY = 'cf_proxy_subscription_url';
	var MAX_STORED = 68;

	function byId(id) {
		return document.getElementById(id);
	}

	function injectStyles() {
		if (byId('lcs-sub-style')) return;
		var style = document.createElement('style');
		style.id = 'lcs-sub-style';
		style.textContent = [
			'.lcs-sub-zone { margin-top: 22px; padding-top: 20px; border-top: 1px dashed var(--line); }',
			'.lcs-sub-zone .field-label { display: flex; align-items: center; gap: 8px; }',
			'.lcs-sub-zone .lcs-sub-tag { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }',
			'.lcs-sub-row { display: flex; gap: 12px; align-items: stretch; flex-wrap: wrap; margin-top: 12px; }',
			'.lcs-sub-row .input-control { flex: 1 1 320px; min-width: 0; }',
			'.lcs-sub-row .primary-btn { flex: 0 0 auto; min-width: 158px; }',
			'.lcs-sub-hint { margin: 12px 0 0; font-size: 0.9rem; color: var(--muted); line-height: 1.6; }',
			'.lcs-sub-hint[data-state="busy"] { color: var(--accent); }',
			'.lcs-sub-hint[data-state="ok"] { color: var(--success); }',
			'.lcs-sub-hint[data-state="error"] { color: var(--error); }',
			'.lcs-sub-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }',
			'.lcs-sub-chip { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.03); font-size: 0.76rem; color: var(--text-soft); }',
			'@media (max-width: 720px) { .lcs-sub-row { flex-direction: column; } .lcs-sub-row .primary-btn { width: 100%; } }'
		].join('\n');
		document.head.appendChild(style);
	}

	function buildZone() {
		if (byId('lcs-sub-zone')) return byId('lcs-sub-zone');

		var zone = document.createElement('div');
		zone.className = 'input-zone lcs-sub-zone';
		zone.id = 'lcs-sub-zone';
		zone.innerHTML = [
			'<label class="field-label" for="lcs-sub-url">订阅链接 <span class="lcs-sub-tag">新增</span></label>',
			'<div class="lcs-sub-row">',
			'<input class="input-control" type="text" id="lcs-sub-url" autocomplete="off" spellcheck="false" placeholder="粘贴订阅链接，例如 https://你的订阅域名/sub">',
			'<button class="primary-btn" id="lcs-sub-btn" type="button"><span>抓取并检测</span><small>Fetch + Check</small></button>',
			'</div>',
			'<p class="lcs-sub-hint" id="lcs-sub-hint" data-state="idle">粘贴订阅链接后回车，会自动提取其中所有 SOCKS5 / HTTP / HTTPS / TURN / SSTP 节点并开始批量检测。</p>',
			'<div class="lcs-sub-summary" id="lcs-sub-summary"></div>'
		].join('');

		var controlRow = document.querySelector('.control-panel .control-row');
		var panel = document.querySelector('.control-panel');
		if (controlRow && controlRow.parentNode) {
			controlRow.parentNode.insertBefore(zone, controlRow);
		} else if (panel) {
			panel.appendChild(zone);
		} else {
			return null;
		}

		var button = byId('lcs-sub-btn');
		var input = byId('lcs-sub-url');
		button.addEventListener('click', function () { runFetch(input.value); });
		input.addEventListener('keydown', function (event) {
			if (event.key === 'Enter') {
				event.preventDefault();
				runFetch(input.value);
			}
		});

		var stored = readStoredUrl();
		if (stored && !input.value) {
			input.value = stored;
			setHint('已回填上次使用的订阅链接，直接点“抓取并检测”即可。', 'idle');
		}
		return zone;
	}

	function setHint(text, state) {
		var hint = byId('lcs-sub-hint');
		if (!hint) return;
		hint.textContent = text;
		hint.dataset.state = state || 'idle';
	}

	function setBusy(isBusy) {
		var button = byId('lcs-sub-btn');
		if (!button) return;
		button.disabled = !!isBusy;
		var label = button.querySelector('span');
		var sub = button.querySelector('small');
		if (label) label.textContent = isBusy ? '抓取中...' : '抓取并检测';
		if (sub) sub.textContent = isBusy ? 'Fetching' : 'Fetch + Check';
	}

	function readStoredUrl() {
		try {
			return window.localStorage.getItem(STORAGE_KEY) || '';
		} catch (error) {
			return '';
		}
	}

	function writeStoredUrl(value) {
		try {
			window.localStorage.setItem(STORAGE_KEY, value.slice(0, MAX_STORED));
		} catch (error) {
			/* 忽略隐私模式下的写入失败 */
		}
	}

	function appendChips(chips) {
		var box = byId('lcs-sub-summary');
		if (!box) return;
		box.innerHTML = '';
		(chips || []).forEach(function (text) {
			var chip = document.createElement('span');
			chip.className = 'lcs-sub-chip';
			chip.textContent = text;
			box.appendChild(chip);
		});
	}

	function collectChips(data) {
		var chips = [];
		var schemeCounts = data.schemeCounts || {};
		Object.keys(schemeCounts).forEach(function (scheme) {
			chips.push(scheme + ' × ' + schemeCounts[scheme]);
		});
		chips.push('来源格式：' + (data.format || 'unknown'));
		if (data.bytes) chips.push('体积：' + data.bytes + ' 字节');
		if (data.truncated) chips.push('已按上限截断');
		return chips;
	}

	function skippedText(unsupported) {
		var keys = Object.keys(unsupported || {});
		if (!keys.length) return '';
		var total = keys.reduce(function (sum, key) { return sum + unsupported[key]; }, 0);
		return '，跳过 ' + total + ' 个不支持的节点（' + keys.slice(0, 5).join('、') + (keys.length > 5 ? ' 等' : '') + '）';
	}

	function requestTargets(url) {
		return fetch(API_PATH, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url: url })
		}).then(function (response) {
			return response.json().catch(function () {
				throw new Error('服务端返回了非 JSON 响应（HTTP ' + response.status + '）');
			}).then(function (data) {
				if (!response.ok || !data || data.ok === false) {
					throw new Error((data && (data.error || data.message)) || ('抓取失败，HTTP ' + response.status));
				}
				return data;
			});
		});
	}

	function ensureBatchMode() {
		var batch = byId('batchMode');
		if (batch && !batch.checked) batch.click();
	}

	function waitForIdle(callback) {
		var button = byId('checkBtn');
		if (!button) {
			callback();
			return;
		}
		if (!button.classList.contains('is-stop')) {
			callback();
			return;
		}
		setHint('检测正在运行，先停止当前任务再开始新的检测...', 'busy');
		button.click();
		var tries = 0;
		var timer = window.setInterval(function () {
			tries += 1;
			var current = byId('checkBtn');
			if (!current || !current.classList.contains('is-stop') || tries > 40) {
				window.clearInterval(timer);
				callback();
			}
		}, 200);
	}

	function fillAndRun(targets, extraChips, message) {
		waitForIdle(function () {
			ensureBatchMode();
			var input = byId('inputList');
			if (!input) {
				setHint('没找到页面上的检测输入框，页面结构可能已被上游改动。', 'error');
				return;
			}
			input.value = targets.join('\n');
			input.dispatchEvent(new Event('input', { bubbles: true }));

			var button = byId('checkBtn');
			if (!button) {
				setHint('没找到“开始检测”按钮，请手动点击页面上的按钮。', 'error');
				return;
			}
			appendChips(extraChips);
			setHint(message || ('已提取 ' + targets.length + ' 个节点，正在开始批量检测。'), 'ok');
			button.click();
		});
	}

	function runFetch(rawUrl) {
		var url = String(rawUrl || '').trim();
		if (!url) {
			setHint('先粘贴一个订阅链接，再点「抓取并检测」。', 'error');
			return;
		}
		writeStoredUrl(url);
		setBusy(true);
		setHint('正在抓取订阅并解析节点...', 'busy');
		appendChips([]);

		requestTargets(url)
			.then(function (data) {
				var targets = Array.isArray(data.targets) ? data.targets : [];
				if (!targets.length) {
					setHint('订阅抓取成功，但没有找到可检测的 SOCKS5 / HTTP / HTTPS / TURN / SSTP 节点。', 'error');
					appendChips(collectChips(data));
					return;
				}
				var chips = collectChips(data);
				fillAndRun(targets, chips, '已提取 ' + targets.length + ' 个节点' + skippedText(data.unsupported) + '，正在开始批量检测。');
			})
			.catch(function (error) {
				setHint(error && error.message ? error.message : '抓取失败，请检查链接后重试。', 'error');
			})
			.then(function () {
				setBusy(false);
			});
	}

	function readQuerySubscription() {
		try {
			var params = new URLSearchParams(window.location.search);
			var value = params.get('sub') || params.get('subscription') || params.get('suburl');
			if (!value) return '';
			window.history.replaceState({}, '', window.location.pathname);
			return value;
		} catch (error) {
			return '';
		}
	}

	function init() {
		injectStyles();
		var zone = buildZone();
		if (!zone) return;

		var pending = readQuerySubscription();
		if (pending) {
			byId('lcs-sub-url').value = pending;
			window.setTimeout(function () { runFetch(pending); }, 300);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
`;

export default CLIENT_SCRIPT;
