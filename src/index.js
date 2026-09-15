/**
 * 入口 Worker：上游 _worker.js 的包装层。
 *
 * 职责只有两件事：
 * 1. 拦截 /subfetch —— 抓取订阅链接并解析出可检测的代理目标；
 * 2. 其余请求原样转交上游，并在返回的 HTML 里注入订阅输入框的前端脚本。
 *
 * 上游文件放在 upstream/_worker.js，由 .github/workflows/sync.yml 自动同步，
 * 所以这里永远不去修改它，上游更新不会产生冲突。
 */

import upstreamWorker from '../upstream/_worker.js';
import { CLIENT_SCRIPT } from './client.js';
import { fetchSubscriptionTargets, normalizeSubscriptionUrl, DEFAULT_SUBSCRIPTION_UA } from './subscription.js';

const SUBSCRIPTION_PATH = '/subfetch';
const DEFAULT_TARGET_LIMIT = 1500;
const INJECT_SNIPPET = '<script data-lcs-subscription="1">' + CLIENT_SCRIPT + '</script>';

class SubscriptionInjector {
	element(element) {
		element.append(INJECT_SNIPPET, { html: true });
	}
}

function subscriptionHeaders(origin = '') {
	return {
		'Access-Control-Allow-Origin': origin || '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400',
		'Content-Type': 'application/json; charset=UTF-8',
		'Cache-Control': 'no-cache, no-store, must-revalidate'
	};
}

function subscriptionJson(data, { status = 200, origin = '' } = {}) {
	return new Response(JSON.stringify(data), { status, headers: subscriptionHeaders(origin) });
}

async function readSubscriptionRequest(request, url) {
	const params = url.searchParams;
	let payload = null;

	if (request.method === 'POST') {
		try {
			payload = await request.json();
		} catch {
			payload = null;
		}
	}

	const pick = key => {
		const fromBody = payload && typeof payload === 'object' ? payload[key] : undefined;
		const value = fromBody !== undefined && fromBody !== null ? fromBody : params.get(key);
		return value === undefined || value === null ? '' : String(value).trim();
	};

	return {
		url: pick('url') || pick('sub') || pick('subscription'),
		ua: pick('ua'),
		limit: pick('limit'),
		allowWeb: pick('web') === '1' || pick('web') === 'true',
		nocache: pick('nocache') === '1' || pick('nocache') === 'true'
	};
}

async function handleSubscriptionRequest(request, url, env) {
	const origin = request.headers.get('Origin') || '';

	if (request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: subscriptionHeaders(origin) });
	}
	if (request.method !== 'GET' && request.method !== 'POST') {
		return subscriptionJson({ ok: false, error: '只支持 GET / POST' }, { status: 405, origin });
	}

	const input = await readSubscriptionRequest(request, url);
	if (!input.url) {
		return subscriptionJson({ ok: false, error: '缺少 url 参数，例如 /subfetch?url=https://example.com/sub' }, { status: 400, origin });
	}

	const limit = Number.parseInt(input.limit || env.SUBSCRIPTION_LIMIT || '', 10);
	const targetLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 20000) : DEFAULT_TARGET_LIMIT;

	try {
		const result = await fetchSubscriptionTargets(input.url, {
			ua: input.ua || env.SUBSCRIPTION_UA || DEFAULT_SUBSCRIPTION_UA,
			allowWebLinksWithoutPort: input.allowWeb,
			nocache: input.nocache
		});

		const targets = result.targets.slice(0, targetLimit);
		return subscriptionJson({
			ok: true,
			url: result.url,
			finalUrl: result.finalUrl,
			normalizedUrl: normalizeSubscriptionUrl(result.finalUrl || result.url),
			format: result.format,
			count: targets.length,
			total: result.targets.length,
			truncated: result.targets.length > targets.length,
			limit: targetLimit,
			targets,
			schemeCounts: result.schemeCounts,
			unsupported: result.unsupported,
			contentType: result.contentType,
			bytes: result.bytes,
			elapsedMs: result.elapsedMs
		}, { origin });
	} catch (error) {
		return subscriptionJson({
			ok: false,
			error: error?.message || String(error)
		}, { status: 502, origin });
	}
}

function injectSubscriptionClient(response) {
	const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
	if (!contentType.includes('text/html')) return response;

	// HTMLRewriter 在 body 末尾追加脚本，上游改了页面结构也照样生效
	return new HTMLRewriter().on('body', new SubscriptionInjector()).transform(response);
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === SUBSCRIPTION_PATH) {
			if (String(env.SUBSCRIPTION_DISABLED || '') === '1') {
				return subscriptionJson({ ok: false, error: 'subscription endpoint disabled' }, { status: 404 });
			}
			return handleSubscriptionRequest(request, url, env);
		}

		const response = await upstreamWorker.fetch(request, env, ctx);
		if (String(env.SUBSCRIPTION_DISABLED || '') === '1') return response;
		return injectSubscriptionClient(response);
	}
};
