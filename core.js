/* ============================================================
 * core.js — 纯逻辑层（无副作用、不依赖 DOM）
 *
 * 职责：状态构造、端口 / UUID 校验、随机取值、命令拼装。
 * 既可在浏览器里通过 <script src="core.js"> 直接引入（挂到
 * globalThis.SingBoxCore / globalThis.buildCommand），
 * 也可在 Node 里 require('core.js') 直接单元测试。
 *
 * 导出的常量与函数见文件底部 api 对象。
 * ============================================================ */
(function (root) {
	"use strict";

	// ---------- 端口取值规则 ----------
	// 用户可填写的有效端口范围（校验用）。
	var PORT_MIN = 1;
	var PORT_MAX = 65535;
	// 随机生成端口时的取值范围（仅用于「随机」图标按钮，不是用户限制）。
	var RANDOM_PORT_MIN = 10000;
	var RANDOM_PORT_MAX = 65535;

	// ---------- 固定命令 ----------
	// 一键安装命令（脚本地址固定）。
	var SCRIPT_CMD = "bash <(curl -Ls https://main.ssss.nyc.mn/sb.sh)";
	// 停止命令：逐字符固定，单引号内的 \.tmp/ 反斜杠需原样保留。
	var STOP_CMD = "pkill -f '\\.tmp/'";

	// ---------- UUID 格式 ----------
	// 标准 UUID：8-4-4-4-12 十六进制，大小写均可，接受任意版本位。
	var UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

	// ---------- 节点名称（NAME）----------
	// 可选变量，最长 40 字符；留空则完全不输出。
	var NAME_MAX = 40;
	// 会破坏 shell 赋值语法的字符（空格 / 引号 / 变量展开 / 管道重定向 / 通配 / 注释等）。
	// 允许中文等非 ASCII 字符：bash 的 NAME=香港节点 是合法赋值。
	var NAME_BAD_RE = /[\s'"`$;|&<>(){}[\]*?!#~\\]/;

	// ---------- 节点定义 ----------
	// 顺序即「添加节点」面板展示顺序（PANEL_ORDER，见下）。
	// tagClass：气泡配色类名（UDP / TCP / Argo 三类互不相同）。
	var PROTOCOLS = [
		{ key: "hy2", name: "hysteria2", kind: "port", varName: "HY2_PORT", tag: "UDP 直连", tagClass: "tag-udp", desc: "抗丢包、速度猛", panelDesc: "UDP，抗丢包、速度猛" },
		{ key: "reality", name: "vless-reality", kind: "port", varName: "REALITY_PORT", tag: "TCP 直连", tagClass: "tag-tcp", desc: "最抗封锁", panelDesc: "TCP，最抗封锁" },
		{ key: "tuic", name: "tuic-v5", kind: "port", varName: "TUIC_PORT", tag: "UDP 直连", tagClass: "tag-udp", desc: "低延迟", panelDesc: "UDP，低延迟" },
		{ key: "s5", name: "socks5", kind: "port", varName: "S5_PORT", tag: "TCP 直连", tagClass: "tag-tcp", desc: "通用代理", panelDesc: "TCP，通用代理" },
		{ key: "anytls", name: "anytls", kind: "port", varName: "ANYTLS_PORT", tag: "TCP 直连", tagClass: "tag-tcp", desc: "伪装成普通网页流量", panelDesc: "TCP，伪装成普通网页流量" },
		{ key: "anyreality", name: "anyreality", kind: "port", varName: "ANYREALITY_PORT", tag: "TCP 直连", tagClass: "tag-tcp", desc: "anytls + reality", panelDesc: "TCP，anytls + reality" },
		{ key: "argo", name: "Argo", kind: "argo", varName: "ARGO_PORT", tag: "CDN 中转", tagClass: "tag-argo", desc: "VMess-WS-TLS 隧道", panelDesc: "VMess-WS-TLS 隧道，脚本默认安装" }
	];

	// 面板展示顺序（「添加节点」下拉）
	var PANEL_ORDER = ["hy2", "reality", "tuic", "s5", "anytls", "anyreality", "argo"];
	// 卡片展示顺序（Argo 置顶）
	var CARD_ORDER = ["argo", "hy2", "reality", "tuic", "s5", "anytls", "anyreality"];
	// 直连端口变量输出顺序（固定，命令里 6 个直连协议的先后）
	var PORT_ORDER = ["hy2", "tuic", "reality", "s5", "anytls", "anyreality"];
	// 完整变量输出顺序（固定契约，UUID 永远第一）：
	// UUID → NAME → CFIP → CFPORT → 6 个直连端口 → ARGO_PORT → ARGO_DOMAIN → ARGO_AUTH / DISABLE_ARGO
	// 其中 NAME 仅在填写时出现（留空不输出）；
	// CFIP / CFPORT / ARGO_PORT / ARGO_DOMAIN / ARGO_AUTH 仅在 Argo 启用时出现。
	var VAR_ORDER = [
		"UUID", "NAME",
		"CFIP", "CFPORT",
		"HY2_PORT", "TUIC_PORT", "REALITY_PORT", "S5_PORT", "ANYTLS_PORT", "ANYREALITY_PORT",
		"ARGO_PORT", "ARGO_DOMAIN", "ARGO_AUTH", "DISABLE_ARGO"
	];

	var PROTO_MAP = {};
	PROTOCOLS.forEach(function (p) { PROTO_MAP[p.key] = p; });

	/**
	 * 生成初始状态：仅 Argo 启用（端口预填 8001），并携带一个随机 UUIDv4。
	 * 说明：这里生成 UUID 是刻意的——保证「首次进入页面即已填好 UUID」，
	 *     且 createInitialState() 返回的状态天然可通过校验。
	 *     注意：buildCommand 本身仍是纯函数（不生成 UUID）。
	 * name 默认为空字符串（可选的节点名称，留空则命令里不输出 NAME）。
	 * @returns {{uuid: string, name: string, nodes: Object}}
	 */
	function createInitialState() {
		var nodes = {};
		PROTOCOLS.forEach(function (p) {
			if (p.kind === "argo") {
				nodes[p.key] = { enabled: true, port: "8001", domain: "", auth: "", cfip: "", cfport: "" };
			} else {
				nodes[p.key] = { enabled: false, port: "" };
			}
		});
		return { uuid: randomUuid(), name: "", nodes: nodes };
	}

	/**
	 * 校验端口：必须是 1–65535 之间的整数。
	 * 严格性：不做任何 trim —— 含空格（"10000 "、" 10000"、"12 345"）一律非法；
	 *        非数字、小数、负数、以 0 开头的多位数字同样非法。
	 * @param {string|number} value
	 * @returns {{ok:boolean, value?:number, reason?:string, message?:string}}
	 */
	function validatePort(value) {
		var raw = value === null || value === undefined ? "" : String(value);
		// 空值，或只由空白字符组成（如用户输入了几个空格）→ 视为未填写
		if (raw === "" || /^\s+$/.test(raw)) {
			return { ok: false, reason: "empty", message: "请填写端口号" };
		}
		if (!/^[0-9]+$/.test(raw)) {
			return { ok: false, reason: "format", message: "端口只能是数字，不能包含空格或其他字符" };
		}
		if (raw.length > 1 && raw.charAt(0) === "0") {
			return { ok: false, reason: "leadingzero", message: "端口不能以 0 开头" };
		}
		var n = Number(raw);
		if (!Number.isInteger(n)) {
			return { ok: false, reason: "format", message: "端口只能是整数" };
		}
		if (n < PORT_MIN || n > PORT_MAX) {
			// 不展示具体数值范围文案，避免误导用户以为必须用大端口。
			return { ok: false, reason: "range", message: "端口超出有效范围" };
		}
		return { ok: true, value: n };
	}

	/**
	 * 校验 UUID：标准 8-4-4-4-12 十六进制，大小写均可，接受任意版本位。
	 * @param {string} value
	 * @returns {{ok:boolean, value?:string, reason?:string, message?:string}}
	 */
	function validateUuid(value) {
		var raw = value === null || value === undefined ? "" : String(value);
		if (raw === "" || /^\s+$/.test(raw)) {
			return { ok: false, reason: "empty", message: "UUID 不能为空，留空会自动生成一个随机 UUID" };
		}
		if (!UUID_RE.test(raw)) {
			return {
				ok: false,
				reason: "format",
				message: "UUID 格式不正确，应为 8-4-4-4-12 的十六进制（例如 b7e4b1f0-3c2a-4d9e-8f11-2a3b4c5d6e7f）"
			};
		}
		return { ok: true, value: raw };
	}

	/**
	 * 校验节点名称（NAME，可选变量）。
	 * 规则：与 CFIP / 域名一致，先去换行制表符并 trim；留空合法（不输出该变量）；
	 *      最长 NAME_MAX 个字符；不允许空格与 shell 特殊符号（避免破坏赋值语法）。
	 * 允许中文等非 ASCII 字符（bash 的 NAME=香港节点 是合法赋值）。
	 * @param {string} value
	 * @returns {{ok:boolean, value?:string, reason?:string, message?:string}}
	 */
	function validateName(value) {
		var raw = cleanValue(value);
		if (raw === "") { return { ok: true, value: "" }; }
		if (raw.length > NAME_MAX) {
			return { ok: false, reason: "toolong", message: "节点名称最长 " + NAME_MAX + " 个字符" };
		}
		if (NAME_BAD_RE.test(raw)) {
			return { ok: false, reason: "format", message: "节点名称不能包含空格或特殊符号（如 ' \" ` $ ; | & < > ( ) { } [ ] * ? ! # ~ \\）" };
		}
		return { ok: true, value: raw };
	}

	/**
	 * 生成一个随机可用端口，自动避开 exclude 中的端口。
	 * 取值始终落在 [RANDOM_PORT_MIN, RANDOM_PORT_MAX]（10000–65535）。
	 * @param {Array<number|string>} [exclude]
	 * @param {function():number} [rng] 便于测试注入的随机源
	 * @returns {number}
	 */
	function randomPort(exclude, rng) {
		var rand = typeof rng === "function" ? rng : Math.random;
		var used = {};
		(exclude || []).forEach(function (v) {
			var n = Number(v);
			if (Number.isInteger(n)) { used[n] = true; }
		});
		var span = RANDOM_PORT_MAX - RANDOM_PORT_MIN + 1;
		for (var i = 0; i < 300; i++) {
			var p = RANDOM_PORT_MIN + Math.floor(rand() * span);
			if (!used[p]) { return p; }
		}
		for (var q = RANDOM_PORT_MIN; q <= RANDOM_PORT_MAX; q++) {
			if (!used[q]) { return q; }
		}
		return RANDOM_PORT_MIN;
	}

	/**
	 * 生成一个符合 RFC 4122 v4 规范的随机 UUID：
	 * 第 3 组以 "4" 开头，第 4 组首字符 ∈ {8,9,a,b}。
	 * 优先使用 crypto.getRandomValues，环境不支持时退回 Math.random。
	 * @returns {string}
	 */
	function randomUuid() {
		var bytes = new Array(16);
		var cryptoObj = (typeof globalThis !== "undefined" && globalThis.crypto) ? globalThis.crypto : null;
		if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
			var arr = new Uint8Array(16);
			cryptoObj.getRandomValues(arr);
			for (var i = 0; i < 16; i++) { bytes[i] = arr[i]; }
		} else {
			for (var j = 0; j < 16; j++) { bytes[j] = Math.floor(Math.random() * 256); }
		}
		bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
		bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
		var hex = [];
		for (var k = 0; k < 16; k++) {
			hex.push((bytes[k] + 0x100).toString(16).slice(1));
		}
		return hex.slice(0, 4).join("") + "-" +
			hex.slice(4, 6).join("") + "-" +
			hex.slice(6, 8).join("") + "-" +
			hex.slice(8, 10).join("") + "-" +
			hex.slice(10, 16).join("");
	}

	/** 清理字符串值：去除换行、制表符并 trim。 */
	function cleanValue(v) {
		if (v === null || v === undefined) { return ""; }
		return String(v).replace(/[\r\n\t]+/g, "").trim();
	}

	/** 用英文单引号包裹，并按 shell 规则转义内部单引号（'\''）。 */
	function quoteSingle(s) {
		return "'" + String(s).replace(/'/g, "'\\''") + "'";
	}

	/**
	 * 根据状态生成安装命令（纯函数：不修改入参、同输入同输出、不依赖时间 / 随机 / DOM）。
	 *
	 * 变量输出顺序（严格固定）：
	 *   UUID → NAME → CFIP → CFPORT → HY2_PORT → TUIC_PORT → REALITY_PORT → S5_PORT →
	 *   ANYTLS_PORT → ANYREALITY_PORT → ARGO_PORT → ARGO_DOMAIN → ARGO_AUTH
	 *   ，未启用 Argo 时末位为 DISABLE_ARGO=true。
	 * 其中 NAME 仅在填写时出现（留空不输出）；
	 * CFIP / CFPORT / ARGO_PORT / ARGO_DOMAIN / ARGO_AUTH 仅在 Argo 启用时出现；
	 * DISABLE_ARGO=true 恒在末位、仅 Argo 删除时出现。
	 * CFPORT 是 CF 节点对外端口，不参与本地监听端口冲突检测。
	 *
	 * @param {{uuid: string, name?: string, nodes: Object}} state
	 * @returns {{
	 *   ok: boolean,
	 *   command: string,
	 *   vars: Array<{name:string, value:string, raw:string}>,
	 *   parts: Array<{type:string, text:string}>,
	 *   errors: Array<{code:string, message:string, fields:string[]}>,
	 *   fields: Object<string, {ok:boolean, message:string}>,
	 *   hasDirect: boolean,
	 *   hasArgo: boolean
	 * }}
	 */
	function buildCommand(state) {
		var nodes = (state && state.nodes) || {};
		var uuidRaw = (state && state.uuid !== undefined && state.uuid !== null) ? String(state.uuid) : "";
		var errors = [];
		var fields = {};
		var vars = [];
		var parts = [];
		var portSeen = {}; // port(String) -> [keys]

		var argo = nodes.argo;
		var hasArgo = !!(argo && argo.enabled);

		// 0) UUID —— 全局鉴权，永远排在最前面（不加引号）
		var uuidRes = validateUuid(uuidRaw);
		if (uuidRes.ok) {
			fields.uuid = { ok: true, message: "" };
			vars.push({ name: "UUID", value: uuidRes.value, raw: uuidRes.value });
		} else {
			fields.uuid = { ok: false, message: uuidRes.message };
			errors.push({ code: "UUID_INVALID", fields: ["uuid"], message: "UUID 无效：" + uuidRes.message });
		}

		// 0.5) NAME —— 可选的节点名称，紧跟 UUID 之后（不加引号）；留空则完全不输出
		var nameRes = validateName(state && state.name);
		if (nameRes.ok) {
			fields.name = { ok: true, message: "" };
			if (nameRes.value !== "") {
				vars.push({ name: "NAME", value: nameRes.value, raw: nameRes.value });
			}
		} else {
			fields.name = { ok: false, message: nameRes.message };
			errors.push({ code: "NAME_INVALID", fields: ["name"], message: "节点名称无效：" + nameRes.message });
		}

		// 1) 基础配置组（仅 Argo 启用时）：CFIP → CFPORT，紧跟 NAME、位于所有端口变量之前
		if (hasArgo) {
			var cfip = cleanValue(argo.cfip);
			if (cfip) {
				vars.push({ name: "CFIP", value: cfip, raw: cfip });
			}
			var cfportRaw = (argo.cfport === undefined || argo.cfport === null) ? "" : String(argo.cfport);
			if (cfportRaw === "" || /^\s+$/.test(cfportRaw)) {
				// 留空合法：不输出 CFPORT，脚本自身会用默认端口（443）
				fields.cfport = { ok: true, message: "" };
			} else {
				var cpRes = validatePort(cfportRaw);
				if (!cpRes.ok) {
					fields.cfport = { ok: false, message: cpRes.message };
					errors.push({
						code: "PORT_INVALID",
						fields: ["cfport"],
						message: "CFPORT 的端口无效：" + cpRes.message
					});
				} else {
					fields.cfport = { ok: true, message: "" };
					// CFPORT 是 CF 节点对外端口，不是本地监听端口，故不参与端口冲突检测
					vars.push({ name: "CFPORT", value: String(cpRes.value), raw: String(cpRes.value) });
				}
			}
		}

		// 2) 直连协议端口：按 PORT_ORDER 固定顺序
		PORT_ORDER.forEach(function (key) {
			var node = nodes[key];
			if (!node || !node.enabled) { return; }
			var def = PROTO_MAP[key];
			var res = validatePort(node.port);
			if (!res.ok) {
				fields[key] = { ok: false, message: res.message };
				errors.push({
					code: "PORT_INVALID",
					fields: [key],
					message: def.name + " 的端口无效：" + res.message
				});
				return;
			}
			fields[key] = { ok: true, message: "" };
			if (!portSeen[res.value]) { portSeen[res.value] = []; }
			portSeen[res.value].push(key);
			vars.push({ name: def.varName, value: String(res.value), raw: String(res.value) });
		});

		// 3) Argo（启用时）：先取端口变量（可留空），再取域名 / 密钥
		if (hasArgo) {
			var argoPortRaw = (argo.port === undefined || argo.port === null) ? "" : String(argo.port);
			if (argoPortRaw === "" || /^\s+$/.test(argoPortRaw)) {
				// 端口留空合法：不输出 ARGO_PORT，脚本自身会用默认 8001
				fields.argo = { ok: true, message: "" };
			} else {
				var apRes = validatePort(argoPortRaw);
				if (!apRes.ok) {
					fields.argo = { ok: false, message: apRes.message };
					errors.push({
						code: "PORT_INVALID",
						fields: ["argo"],
						message: "Argo 的端口无效：" + apRes.message
					});
				} else {
					fields.argo = { ok: true, message: "" };
					if (!portSeen[apRes.value]) { portSeen[apRes.value] = []; }
					portSeen[apRes.value].push("argo");
					vars.push({ name: "ARGO_PORT", value: String(apRes.value), raw: String(apRes.value) });
				}
			}
		}

		// 4) 端口冲突：任意两个已启用协议（含 Argo 端口，不含 CFPORT）端口相同
		Object.keys(portSeen).forEach(function (portStr) {
			var keys = portSeen[portStr];
			if (keys.length < 2) { return; }
			var names = keys.map(function (k) { return PROTO_MAP[k].name; });
			keys.forEach(function (k, idx) {
				var others = names.filter(function (_, i) { return i !== idx; });
				fields[k] = { ok: false, message: "端口与 " + others.join("、") + " 重复" };
			});
			errors.push({
				code: "PORT_CONFLICT",
				fields: keys.slice(),
				message: "端口冲突：" + names.join(" 与 ") + " 都使用了端口 " + portStr + "，请改成不同的端口。"
			});
		});

		// 5) Argo 域名 / 密钥（或 DISABLE_ARGO）
		if (hasArgo) {
			var domain = cleanValue(argo.domain);
			var auth = cleanValue(argo.auth);
			if (domain) { vars.push({ name: "ARGO_DOMAIN", value: domain, raw: domain }); }
			if (auth) { vars.push({ name: "ARGO_AUTH", value: quoteSingle(auth), raw: auth }); }
		} else {
			vars.push({ name: "DISABLE_ARGO", value: "true", raw: "true" });
		}

		// 6) 空状态：既没有直连协议，也没有 Argo
		var hasDirect = PORT_ORDER.some(function (k) { return nodes[k] && nodes[k].enabled; });
		if (!hasDirect && !hasArgo) {
			errors.push({ code: "EMPTY", fields: [], message: "至少启用一个节点" });
		}

		var ok = errors.length === 0;
		var command = "";
		if (ok) {
			var assign = vars.map(function (v) { return v.name + "=" + v.value; }).join(" ");
			command = assign ? assign + " " + SCRIPT_CMD : SCRIPT_CMD;
			vars.forEach(function (v, i) {
				if (i > 0) { parts.push({ type: "sep", text: " " }); }
				parts.push({ type: "var", text: v.name });
				parts.push({ type: "eq", text: "=" });
				parts.push({ type: "val", text: v.value });
			});
			if (vars.length) { parts.push({ type: "sep", text: " " }); }
			parts.push({ type: "bash", text: SCRIPT_CMD });
		}

		return {
			ok: ok,
			command: command,
			vars: vars,
			parts: parts,
			errors: errors,
			fields: fields,
			hasDirect: hasDirect,
			hasArgo: hasArgo
		};
	}

	var api = {
		PORT_MIN: PORT_MIN,
		PORT_MAX: PORT_MAX,
		RANDOM_PORT_MIN: RANDOM_PORT_MIN,
		RANDOM_PORT_MAX: RANDOM_PORT_MAX,
		NAME_MAX: NAME_MAX,
		SCRIPT_CMD: SCRIPT_CMD,
		STOP_CMD: STOP_CMD,
		PROTOCOLS: PROTOCOLS,
		PROTO_MAP: PROTO_MAP,
		PANEL_ORDER: PANEL_ORDER,
		CARD_ORDER: CARD_ORDER,
		PORT_ORDER: PORT_ORDER,
		VAR_ORDER: VAR_ORDER,
		createInitialState: createInitialState,
		validatePort: validatePort,
		validateUuid: validateUuid,
		validateName: validateName,
		randomPort: randomPort,
		randomUuid: randomUuid,
		cleanValue: cleanValue,
		quoteSingle: quoteSingle,
		buildCommand: buildCommand
	};

	root.SingBoxCore = api;
	root.buildCommand = buildCommand;

	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
})(typeof globalThis !== "undefined" ? globalThis : this);
