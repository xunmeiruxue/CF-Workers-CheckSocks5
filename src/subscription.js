/**
 * 订阅抓取与解析。
 *
 * 目标：把一个订阅链接里的节点，转换成本项目能检测的代理目标
 * (socks5 / http / https / turn / sstp)，其余协议只做统计不做检测。
 */

export const SUPPORTED_SCHEMES = ['socks5', 'http', 'https', 'turn', 'sstp'];

export const DEFAULT_PORTS = {
	socks5: 1080,
	http: 80,
	https: 443,
	turn: 3478,
	sstp: 443
};

export const DEFAULT_SUBSCRIPTION_UA = 'v2rayN/6.0';
export const MAX_SUBSCRIPTION_BYTES = 4 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15000;

// scheme 别名 -> 本项目支持的 scheme
const SCHEME_ALIASES = {
	socks5: 'socks5',
	socks5h: 'socks5',
	socks: 'socks5',
	http: 'http',
	https: 'https',
	turn: 'turn',
	turns: 'turn',
	sstp: 'sstp'
};

// 订阅里常见但不属于本项目的协议，命中时只统计
const KNOWN_UNSUPPORTED = new Set([
	'vmess', 'vless', 'trojan', 'trojan-go', 'ss', 'ssr', 'ssd', 'socks4', 'socks4a',
	'hysteria', 'hysteria2', 'hy2', 'tuic', 'snell', 'anytls', 'wireguard', 'mieru',
	'ssh', 'shadowtls', 'juicity', 'naive', 'naive+https', 'http2', 'grpc', 'ws', 'wss'
]);

// 一个链接的 scheme+authority，前导字符用于避免匹配 xxxhttp:// 这类粘连文本
const LINK_PATTERN = /(^|[^0-9a-zA-Z+._-])([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\s"'<>\\|]+)/g;

const BLOCKED_HOST_PATTERNS = [
	/^localhost$/i,
	/\.local$/i,
	/\.internal$/i,
	/\.localhost$/i,
	/^127\./,
	/^0\./,
	/^10\./,
	/^192\.168\./,
	/^169\.254\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^\[?::1\]?$/i,
	/^\[?(fc|fd)[0-9a-f]{2}:/i
];

function stripWrappers(value) {
	let text = String(value ?? '').trim();
	while (text && /^[\s"'<>({\[]/.test(text)) {
		const head = text[0];
		const tail = text[text.length - 1];
		if (head === '(' && tail === ')') { text = text.slice(1, -1).trim(); continue; }
		if (head === '{' && tail === '}') { text = text.slice(1, -1).trim(); continue; }
		if (head === '"' && tail === '"') { text = text.slice(1, -1).trim(); continue; }
		if (head === "'" && tail === "'") { text = text.slice(1, -1).trim(); continue; }
		if (head === '<' && tail === '>') { text = text.slice(1, -1).trim(); continue; }
		break;
	}
	// 末尾标点（保留 IPv6 的右方括号）
	return text.replace(/[,;：\s]+$/u, '').trim();
}

function sanitizeCredential(value) {
	const text = String(value ?? '').trim();
	if (!text) return '';
	try {
		return encodeURIComponent(decodeURIComponent(text));
	} catch {
		return encodeURIComponent(text);
	}
}

function parseAuthority(authority, scheme) {
	const value = String(authority || '').split('/')[0].trim();
	if (!value) return null;

	const at = value.lastIndexOf('@');
	const credential = at === -1 ? '' : value.slice(0, at);
	let hostPort = at === -1 ? value : value.slice(at + 1);

	// 去掉残留的 query（auth 里可能带 %3F，不处理）
	const queryIndex = hostPort.indexOf('?');
	if (queryIndex !== -1) hostPort = hostPort.slice(0, queryIndex);

	let host = '';
	let portText = '';

	if (hostPort.startsWith('[')) {
		const close = hostPort.indexOf(']');
		if (close === -1) return null;
		host = hostPort.slice(0, close + 1);
		const rest = hostPort.slice(close + 1);
		if (rest.startsWith(':')) portText = rest.slice(1);
		else if (rest) return null;
	} else {
		const colon = hostPort.lastIndexOf(':');
		if (colon === -1) {
			host = hostPort;
		} else {
			const maybeHost = hostPort.slice(0, colon);
			const maybePort = hostPort.slice(colon + 1);
			if (/^\d+$/.test(maybePort) && maybeHost.indexOf(':') === -1) {
				host = maybeHost;
				portText = maybePort;
			} else if (maybeHost.indexOf(':') !== -1) {
				// 裸 IPv6 无法区分最后一节是端口，直接放弃
				return null;
			} else {
				host = hostPort;
			}
		}
	}

	host = host.trim();
	if (!host) return null;
	if (/[\s@]/.test(host)) return null;

	let port = Number.parseInt(portText, 10);
	if (!portText) port = DEFAULT_PORTS[scheme] || 0;
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

	let credentialText = '';
	if (credential) {
		const splitAt = credential.indexOf(':');
		const user = splitAt === -1 ? credential : credential.slice(0, splitAt);
		const pass = splitAt === -1 ? '' : credential.slice(splitAt + 1);
		const safeUser = sanitizeCredential(user);
		const safePass = splitAt === -1 ? '' : sanitizeCredential(pass);
		credentialText = safeUser + (splitAt === -1 ? '' : ':' + safePass) + '@';
	}

	return {
		scheme,
		host,
		port,
		credential: credentialText,
		target: scheme + '://' + credentialText + host + ':' + port
	};
}

/**
 * 把任意一段文本规范化成可检测的代理目标，失败返回 null。
 * 缺端口时按协议默认端口补齐，未知协议返回 null。
 */
export function normalizeProxyTarget(raw) {
	const text = stripWrappers(raw);
	const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.+)$/.exec(text);
	if (!match) return null;

	const scheme = SCHEME_ALIASES[match[1].toLowerCase()];
	if (!scheme) return null;

	const authority = match[2].split('#')[0];
	const parsed = parseAuthority(authority, scheme);
	return parsed ? parsed.target : null;
}

/** 裸 host:port（可带 user:pass@），仅整行匹配时接受，按 socks5 处理 */
export function normalizeBareTarget(raw) {
	const text = stripWrappers(raw);
	if (!text || text.includes('://')) return null;
	if (!/^[^\s@:\/]+(:[^\s@\/]+)?@?[^\s@\/]+:\d{1,5}$/.test(text)) return null;
	return normalizeProxyTarget('socks5://' + text);
}

function createCollector() {
	return {
		targets: [],
		seen: new Set(),
		unsupported: {},
		schemeCounts: {}
	};
}

function collect(collector, raw, schemeHint) {
	const target = normalizeProxyTarget(raw) || (schemeHint === 'bare' ? normalizeBareTarget(raw) : null);
	if (!target) return false;
	if (collector.seen.has(target)) return false;
	collector.seen.add(target);
	collector.targets.push(target);
	const scheme = target.slice(0, target.indexOf('://'));
	collector.schemeCounts[scheme] = (collector.schemeCounts[scheme] || 0) + 1;
	return true;
}

function noteUnsupported(collector, scheme) {
	const key = String(scheme || '').toLowerCase();
	if (!key) return;
	collector.unsupported[key] = (collector.unsupported[key] || 0) + 1;
}

function isPrivateHost(host) {
	const value = String(host || '').trim();
	return BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * 明文订阅解析：提取受支持的代理链接；没有链接时回退成 host:port 行。
 * @param {string} text
 * @param {{ allowWebLinksWithoutPort?: boolean }} [options]
 */
export function extractTargetsFromPlainText(text, options = {}) {
	const collector = createCollector();
	const body = String(text ?? '');
	const allowWebWithoutPort = options.allowWebLinksWithoutPort === true;
	let sawHttpLinkWithoutPort = false;

	LINK_PATTERN.lastIndex = 0;
	let match;
	while ((match = LINK_PATTERN.exec(body)) !== null) {
		const schemeKey = match[2].toLowerCase();
		const rawLink = schemeKey + '://' + match[3];

		if (SCHEME_ALIASES[schemeKey]) {
			if (!allowWebWithoutPort && (schemeKey === 'http' || schemeKey === 'https')) {
				const hostPort = rawLink.slice(schemeKey.length + 3).split('/')[0].split('@').pop();
				if (!/^\[[^\]]+\]:\d+$|:[0-9]{1,5}$/.test(hostPort)) {
					sawHttpLinkWithoutPort = true;
					continue;
				}
			}
			if (isPrivateHost(rawLink.slice(schemeKey.length + 3).split('/')[0].split('@').pop().replace(/^\[|\]:\d+$|:\d+$/g, ''))) {
				continue;
			}
			collect(collector, rawLink);
			continue;
		}

		if (KNOWN_UNSUPPORTED.has(schemeKey) || /^[a-z][a-z0-9+.-]*$/.test(schemeKey)) {
			noteUnsupported(collector, schemeKey);
		}
	}

	const plainLines = [];
	for (const line of body.split(/\r?\n/)) {
		const trimmed = line.trim().replace(/\s+#.*$/, '');
		if (!trimmed || trimmed.includes('://')) continue;
		plainLines.push(trimmed);
	}

	const shouldFallbackToBare = collector.targets.length === 0
		|| (collector.targets.length > 0 && !Object.keys(collector.schemeCounts).some(scheme => scheme !== 'http' && scheme !== 'https'));

	if (shouldFallbackToBare) {
		for (const line of plainLines) {
			if (!collect(collector, line, 'bare')) {
				if (line.includes(':') && /^[^\s@:\/]+(:[^\s@\/]+)?@?[^\s@\/]+:\d{1,5}$/.test(line)) noteUnsupported(collector, 'unknown');
				continue;
			}
		}
	}

	return {
		targets: collector.targets,
		unsupported: collector.unsupported,
		schemeCounts: collector.schemeCounts,
		sawHttpLinkWithoutPort
	};
}

function stripYamlComment(line) {
	let quote = '';
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quote) {
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") { quote = char; continue; }
		if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
	}
	return line;
}

function unquoteYamlValue(value) {
	const text = String(value ?? '').trim();
	if (text.length >= 2) {
		const head = text[0];
		const tail = text[text.length - 1];
		if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) {
			return text.slice(1, -1);
		}
	}
	return text;
}

function parseFlowMapping(body) {
	const text = String(body || '').trim().replace(/^\{/, '').replace(/\}$/, '');
	const parts = [];
	let current = '';
	let quote = '';
	for (const char of text) {
		if (quote) {
			current += char;
			if (char === quote) quote = '';
			continue;
		}
		if (char === '"' || char === "'") { quote = char; current += char; continue; }
		if (char === ',') { parts.push(current); current = ''; continue; }
		current += char;
	}
	if (current.trim()) parts.push(current);

	const record = {};
	for (const part of parts) {
		const colon = part.indexOf(':');
		if (colon === -1) continue;
		const key = part.slice(0, colon).trim();
		const value = part.slice(colon + 1).trim();
		if (key) record[key] = unquoteYamlValue(value);
	}
	return record;
}

function applyKeyValue(record, body) {
	const colon = body.indexOf(':');
	if (colon === -1) return;
	const key = body.slice(0, colon).trim();
	const value = body.slice(colon + 1).trim();
	if (key) record[key] = unquoteYamlValue(value);
}

/** 提取顶层 key（如 proxies）对应的 YAML 段落 */
function extractTopLevelSection(text, key) {
	const lines = String(text ?? '').split(/\r?\n/);
	const header = new RegExp('^' + key + '\\s*:');
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (header.test(lines[i])) { start = i + 1; break; }
	}
	if (start === -1) return '';

	const section = [];
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() && !/^\s/.test(line)) break;
		section.push(line);
	}
	return section.join('\n');
}

function parseYamlProxyList(sectionText) {
	const items = [];
	let current = null;
	for (const rawLine of sectionText.split(/\r?\n/)) {
		const line = stripYamlComment(rawLine).replace(/\s+$/, '');
		if (!line.trim()) continue;
		const trimmed = line.trim();
		if (trimmed.startsWith('- ') || trimmed === '-') {
			const body = trimmed.slice(1).trim();
			if (!body) { current = {}; items.push(current); continue; }
			if (body.startsWith('{')) { items.push(parseFlowMapping(body)); current = null; continue; }
			current = {};
			items.push(current);
			applyKeyValue(current, body);
			continue;
		}
		if (current) applyKeyValue(current, trimmed);
	}
	return items;
}

const CLASH_TYPE_MAP = {
	socks5: 'socks5',
	socks: 'socks5',
	http: 'http',
	https: 'https'
};

/** 解析 Clash / mihomo 订阅里的 proxies 列表 */
export function parseClashYaml(text) {
	const collector = createCollector();
	const section = extractTopLevelSection(text, 'proxies');
	if (!section.trim()) {
		return { targets: [], unsupported: {}, schemeCounts: {}, matched: false };
	}

	for (const item of parseYamlProxyList(section)) {
		const type = String(item.type || '').toLowerCase();
		const mapped = CLASH_TYPE_MAP[type];
		if (!mapped) {
			if (type) noteUnsupported(collector, type);
			continue;
		}
		const tls = String(item.tls || '').toLowerCase() === 'true' || String(item.tls || '') === '1';
		const scheme = mapped === 'http' && tls ? 'https' : mapped;
		const server = String(item.server || '').trim();
		const port = String(item.port || '').trim();
		if (!server || !port) continue;
		const credential = item.username
			? sanitizeCredential(item.username) + ':' + sanitizeCredential(item.password || '') + '@'
			: '';
		collect(collector, scheme + '://' + credential + server + ':' + port);
	}

	return {
		targets: collector.targets,
		unsupported: collector.unsupported,
		schemeCounts: collector.schemeCounts,
		matched: true
	};
}

function collectOutbound(collector, scheme, host, port, username, password) {
	if (!host || !port) return;
	const credential = username
		? sanitizeCredential(username) + ':' + sanitizeCredential(password || '') + '@'
		: '';
	collect(collector, scheme + '://' + credential + host + ':' + port);
}

/** 解析 sing-box / Xray(v2ray) 的 JSON 配置型订阅 */
export function parseConfigJson(text) {
	const collector = createCollector();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return { targets: [], unsupported: {}, schemeCounts: {}, matched: false };
	}

	const list = Array.isArray(data)
		? data
		: [data.outbounds, data.proxies, data.endpoints].find(Array.isArray) || [];
	if (!list.length) return { targets: [], unsupported: {}, schemeCounts: {}, matched: false };

	for (const entry of list) {
		if (!entry || typeof entry !== 'object') continue;
		const type = String(entry.type || entry.protocol || '').toLowerCase();
		const mapped = { socks: 'socks5', socks5: 'socks5', http: 'http', https: 'https' }[type];
		if (!mapped) {
			if (type) noteUnsupported(collector, type);
			continue;
		}

		// Xray / v2ray 结构：settings.servers[]
		if (entry.settings && Array.isArray(entry.settings.servers)) {
			const secure = String(entry.streamSettings?.security || '').toLowerCase() === 'tls';
			const scheme = mapped === 'http' && secure ? 'https' : mapped;
			for (const server of entry.settings.servers) {
				if (!server || typeof server !== 'object') continue;
				const user = Array.isArray(server.users) && server.users.length ? server.users[0] : null;
				collectOutbound(
					collector,
					scheme,
					String(server.address || '').trim(),
					String(server.port || '').trim(),
					user ? user.user : '',
					user ? user.pass : ''
				);
			}
			continue;
		}

		// sing-box 结构：扁平字段
		const secure = entry.tls && typeof entry.tls === 'object'
			? entry.tls.enabled !== false
			: entry.tls === true;
		const scheme = mapped === 'http' && secure ? 'https' : mapped;
		collectOutbound(
			collector,
			scheme,
			String(entry.server || entry.address || '').trim(),
			String(entry.server_port || entry.port || '').trim(),
			entry.username || entry.user || '',
			entry.password || entry.pass || ''
		);
	}

	return {
		targets: collector.targets,
		unsupported: collector.unsupported,
		schemeCounts: collector.schemeCounts,
		matched: true
	};
}

function base64ToText(value) {
	const normalized = String(value || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length < 16) return '';
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	} catch {
		return '';
	}
}

function looksLikeSubscriptionBody(text) {
	const sample = String(text || '').slice(0, 20000);
	return /[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(sample) || /(^|\n)proxies\s*:/.test(sample) || sample.trim().startsWith('{');
}

/**
 * 入口：把订阅响应体解析成目标列表。
 * 依次尝试 JSON 配置、Clash YAML、base64、明文。
 */
export function parseSubscriptionBody(body, contentType = '') {
	const text = String(body ?? '').replace(/^\uFEFF/, '');
	const trimmed = text.trim();

	if (!trimmed) {
		return { format: 'empty', targets: [], unsupported: {}, schemeCounts: {}, sawHttpLinkWithoutPort: false };
	}

	const asJson = trimmed.startsWith('{') || trimmed.startsWith('[') || contentType.toLowerCase().includes('json');
	if (asJson) {
		const result = parseConfigJson(trimmed);
		if (result.matched && result.targets.length) {
			return { format: 'json', ...result };
		}
	}

	if (/(^|\n)proxies\s*:/.test(trimmed)) {
		const result = parseClashYaml(trimmed);
		if (result.matched && result.targets.length) {
			return { format: 'clash', ...result };
		}
	}

	const decoded = base64ToText(trimmed);
	if (decoded && decoded !== trimmed && looksLikeSubscriptionBody(decoded)) {
		const result = parseSubscriptionBody(decoded, '');
		if (result.targets.length) {
			return { ...result, format: result.format === 'empty' ? 'base64' : result.format + '+base64' };
		}
	}

	const plain = extractTargetsFromPlainText(text);
	return { format: 'plain', ...plain };
}

export function normalizeSubscriptionUrl(value) {
	let text = String(value ?? '').trim();
	if (!text) return '';
	if (text.startsWith('//')) text = 'https:' + text;
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) text = 'https://' + text;
	return text;
}

export function isBlockedSubscriptionHost(url) {
	let hostname = '';
	try {
		hostname = new URL(url).hostname;
	} catch {
		return true;
	}
	return isPrivateHost(hostname);
}

/**
 * 抓取订阅并解析出目标列表。
 * @param {string} rawUrl
 * @param {{ ua?: string, timeoutMs?: number, maxBytes?: number, allowWebLinksWithoutPort?: boolean, allowPrivate?: boolean, nocache?: boolean }} [options]
 */
export async function fetchSubscriptionTargets(rawUrl, options = {}) {
	const started = Date.now();
	const url = normalizeSubscriptionUrl(rawUrl);
	if (!url) throw new Error('缺少订阅链接');

	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error('订阅链接格式不正确');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('只支持 http / https 订阅链接');
	}
	if (!options.allowPrivate && isBlockedSubscriptionHost(url)) {
		throw new Error('订阅链接指向内网或保留地址，已跳过');
	}

	const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
	const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_SUBSCRIPTION_BYTES;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	let response;
	try {
		const init = {
			method: 'GET',
			redirect: 'follow',
			signal: controller.signal,
			headers: {
				'User-Agent': options.ua || DEFAULT_SUBSCRIPTION_UA,
				Accept: '*/*',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
			}
		};
		if (!options.nocache) {
			init.cf = { cacheEverything: true, cacheTtl: 60 };
		}
		response = await fetch(url, init);
	} catch (error) {
		clearTimeout(timer);
		if (error?.name === 'AbortError') throw new Error('订阅请求超时（' + timeoutMs + 'ms）');
		throw new Error('订阅请求失败：' + (error?.message || String(error)));
	}
	clearTimeout(timer);

	if (!response.ok) {
		throw new Error('订阅返回 HTTP ' + response.status);
	}

	const declaredLength = Number.parseInt(response.headers.get('Content-Length') || '', 10);
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new Error('订阅内容过大（' + declaredLength + ' 字节），已超过上限 ' + maxBytes);
	}

	const buffer = await response.arrayBuffer();
	if (buffer.byteLength > maxBytes) {
		throw new Error('订阅内容过大（' + buffer.byteLength + ' 字节），已超过上限 ' + maxBytes);
	}

	const body = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
	const parsedBody = parseSubscriptionBody(body, response.headers.get('Content-Type') || '');

	return {
		url,
		finalUrl: response.url || url,
		format: parsedBody.format,
		targets: parsedBody.targets,
		schemeCounts: parsedBody.schemeCounts || {},
		unsupported: parsedBody.unsupported || {},
		contentType: response.headers.get('Content-Type') || '',
		bytes: buffer.byteLength,
		elapsedMs: Date.now() - started
	};
}
