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
	// Argo 端的**脚本默认端口**：ARGO_PORT 留空时脚本自身会用 8001。
	// 页面默认不再预填 8001（输入框用 placeholder 提示），但**冲突检测仍须把这 8001 视为已占用**：
	// 否则用户把某个直连协议手工填成 8001、同时 Argo 端口留空时，会生成一条实际端口打架的命令。
	var ARGO_DEFAULT_PORT = 8001;

	// ---------- 固定命令 ----------
	// 一键安装命令（脚本地址固定）。
	var SCRIPT_CMD = "bash <(curl -Ls https://main.ssss.nyc.mn/sb.sh)";
	// 停止命令：逐字符固定，单引号内的 \.tmp/ 反斜杠需原样保留。
	var STOP_CMD = "pkill -f '\\.tmp/'";
	// 查看订阅命令：安装完成后查看脚本生成的订阅文件内容（2026-09-20 新增「查看订阅」区块）。
	var SUB_CMD = "cat .tmp/sub.txt";

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
	// 本数组的声明顺序**不再等于**界面展示顺序：展示顺序由 orderedKeys() 按 rating 降序派生
	// （Argo 永远置顶）；声明顺序只作为**同分时的稳定排序依据**。
	// 展示四件套：name（名称）+ tag / tagClass（传输类型气泡）+ desc（一句话简介）+ rating（推荐指数）。
	// name / tag / desc **卡片与「添加节点」面板共用**，不再有第二套简介文案（原 panelDesc 已删除）；
	// rating 目前只在「添加节点」面板里显示（选之前给个参考），卡片上不显示。
	// tagClass：气泡配色类名（UDP / TCP / Argo 三类互不相同，纯视觉）。
	// transport：**端口空间分类**，决定冲突检测口径——UDP 与 TCP 是两套独立的端口空间，
	//           只有「同一 transport + 同一端口号」才算端口冲突。
	//           分组口径：hy2 / tuic = udp；reality / s5 / anytls / anyreality = tcp；
	//           Argo（cloudflared VMess-WS-TLS 隧道本地入站）也是 **tcp**。
	// 注意：tagClass 只管气泡配色——「传输分类」的两色系（tag-udp / tag-tcp）与 transport 一致，
	//       但 Argo 的气泡另用中立的 tag-argo，**不要**据 tagClass 反推 transport。
	var PROTOCOLS = [
		{ key: "hy2", name: "Hysteria2", kind: "port", varName: "HY2_PORT", transport: "udp", tag: "UDP 直连", tagClass: "tag-udp", desc: "暴力发包，劣质线路首选", rating: 4 },
		{ key: "reality", name: "VLESS-Reality", kind: "port", varName: "REALITY_PORT", transport: "tcp", tag: "TCP 直连", tagClass: "tag-tcp", desc: "最抗封锁，优质线路首选", rating: 4.5 },
		{ key: "tuic", name: "Tuic-v5", kind: "port", varName: "TUIC_PORT", transport: "udp", tag: "UDP 直连", tagClass: "tag-udp", desc: "延迟低，打游戏更顺", rating: 3.5 },
		{ key: "s5", name: "Socks5", kind: "port", varName: "S5_PORT", transport: "tcp", tag: "TCP 直连", tagClass: "tag-tcp", desc: "通用代理，无加密易被封", rating: 0.5 },
		{ key: "anytls", name: "AnyTLS", kind: "port", varName: "ANYTLS_PORT", transport: "tcp", tag: "TCP 直连", tagClass: "tag-tcp", desc: "抗封锁，值得一试", rating: 4 },
		{ key: "anyreality", name: "AnyReality", kind: "port", varName: "ANYREALITY_PORT", transport: "tcp", tag: "TCP 直连", tagClass: "tag-tcp", desc: "抗封锁，需新版客户端", rating: 3 },
		{ key: "argo", name: "Argo", kind: "argo", varName: "ARGO_PORT", transport: "tcp", tag: "CDN 中转", tagClass: "tag-argo", desc: "VMess-WS-TLS，CF 中转抗封锁", rating: 3.5 }
	];
	// 参与冲突检测的端口空间（固定遍历顺序：先 UDP，再 TCP）。
	var TRANSPORTS = ["udp", "tcp"];

	// ---------- 推荐指数（rating）----------
	// 满分 5 星，**支持半星**（取值按 0.5 步进；写入任意数值都会被 normalizeRating 吸附到 0.5）。
	// 只做展示，不参与命令生成。
	var RATING_MAX = 5;
	var RATING_STEP = 0.5;

	/**
	 * 归一化推荐指数：非有限数 → 0；越界钳到 [0, RATING_MAX]；按 RATING_STEP 吸附。
	 * @param {*} value
	 * @returns {number} 0 ~ 5，0.5 的整数倍
	 */
	function normalizeRating(value) {
		var n = Number(value);
		if (!isFinite(n)) { return 0; }
		if (n < 0) { n = 0; }
		if (n > RATING_MAX) { n = RATING_MAX; }
		return Math.round(n / RATING_STEP) * RATING_STEP;
	}

	/**
	 * 把推荐指数拆成每颗星的填充度，供渲染层直接使用（纯函数，便于单测）。
	 * 例：4.5 → [1, 1, 1, 1, 0.5]；0 → [0, 0, 0, 0, 0]；5 → [1, 1, 1, 1, 1]。
	 * @param {*} value
	 * @returns {Array<number>} 长度为 RATING_MAX，元素 ∈ {0, 0.5, 1}
	 */
	function starFills(value) {
		var v = normalizeRating(value);
		var out = [];
		for (var i = 0; i < RATING_MAX; i++) {
			var d = v - i;
			out.push(d >= 1 ? 1 : (d >= RATING_STEP ? RATING_STEP : 0));
		}
		return out;
	}

	/**
	 * 列表展示顺序（「已选节点」卡片 与「添加节点」下拉 共用同一条规则）：
	 * **Argo 永远置顶**，其余按推荐指数（rating）**降序**；
	 * 同分时保持 `PROTOCOLS` 的声明顺序（稳定排序，避免顺序随机跳动）。
	 *
	 * 关键：顺序**由 rating 派生**，不是写死的数组 —— 改 `PROTOCOLS[].rating` 后顺序自动跟着变。
	 * 只影响「列表展示」，**不影响命令里的变量输出顺序**（那是 `PORT_ORDER` / `VAR_ORDER` 的冻结契约）。
	 * @returns {Array<string>} 节点 key 的展示顺序
	 */
	function orderedKeys() {
		var first = [], rest = [];
		PROTOCOLS.forEach(function (p, i) {
			if (p.kind === "argo") { first.push(p.key); }
			else { rest.push({ key: p.key, rating: normalizeRating(p.rating), i: i }); }
		});
		rest.sort(function (a, b) { return (b.rating - a.rating) || (a.i - b.i); });
		return first.concat(rest.map(function (r) { return r.key; }));
	}

	// 面板展示顺序（「添加节点」下拉）与卡片展示顺序：同为「Argo 置顶 + 推荐指数降序」。
	// 两个名字保留是因为它们描述的是两个不同的界面位置；万一将来需要分开定义，改各自那一行即可。
	var PANEL_ORDER = orderedKeys();
	var CARD_ORDER = orderedKeys();
	// 直连端口变量输出顺序（固定，命令里 6 个直连协议的先后）
	var PORT_ORDER = ["hy2", "tuic", "reality", "s5", "anytls", "anyreality"];
	// 完整变量输出顺序（固定契约，UUID 永远第一）：
	// UUID → NAME → SHOW_LOG → CFIP → CFPORT → 6 个直连端口 → ARGO_PORT → ARGO_DOMAIN → ARGO_AUTH / DISABLE_ARGO
	// 其中 NAME / SHOW_LOG 仅在「非默认态」时才出现：
	//   - NAME 留空不输出；
	//   - SHOW_LOG 默认开启（= 脚本默认）故不输出，仅关闭日志输出时输出 `SHOW_LOG=false`。
	// CFIP / CFPORT / ARGO_PORT / ARGO_DOMAIN / ARGO_AUTH 仅在 Argo 启用时出现。
	// DISABLE_ARGO 恒末位（冻结契约）。
	var VAR_ORDER = [
		"UUID", "NAME", "SHOW_LOG",
		"CFIP", "CFPORT",
		"HY2_PORT", "TUIC_PORT", "REALITY_PORT", "S5_PORT", "ANYTLS_PORT", "ANYREALITY_PORT",
		"ARGO_PORT", "ARGO_DOMAIN", "ARGO_AUTH", "DISABLE_ARGO"
	];

	var PROTO_MAP = {};
	PROTOCOLS.forEach(function (p) { PROTO_MAP[p.key] = p; });

	/**
	 * 生成初始状态：仅 Argo 启用，端口**留空**（输入框用 placeholder "8001" 提示脚本默认值），
	 * 并携带一个随机 UUIDv4。
	 * 说明：这里生成 UUID 是刻意的——保证「首次进入页面即已填好 UUID」，
	 *     且 createInitialState() 返回的状态天然可通过校验。
	 *     Argo 端口留空是合法的：不输出 ARGO_PORT，脚本自身用默认 8001，
	 *     因此首屏命令就是最简的 `UUID=… bash <(curl …)`。
	 *     注意：buildCommand 本身仍是纯函数（不生成 UUID）。
	 * name 默认为空字符串（可选的节点名称，留空则命令里不输出 NAME）。
	 * showLog 默认为 true（日志输出开关，脚本默认开启 → 命令里不输出 SHOW_LOG）。
	 * @returns {{uuid: string, name: string, showLog: boolean, nodes: Object}}
	 */
	function createInitialState() {
		var nodes = {};
		PROTOCOLS.forEach(function (p) {
			if (p.kind === "argo") {
				nodes[p.key] = { enabled: true, port: "", domain: "", auth: "", cfip: "", cfport: "" };
			} else {
				nodes[p.key] = { enabled: false, port: "" };
			}
		});
		return { uuid: randomUuid(), name: "", showLog: true, nodes: nodes };
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
	 *
	 * 约定：调用方（app.js 的 usedPorts()）传入的是**全部**已占用端口，**不分传输方式**
	 * （即 UDP 与 TCP 的端口混在一起）。随机结果不得落在任何已占用端口上——
	 * 即便某端口号在 UDP / TCP 上可合法共存，随机时也一并避开，避免出现「看起来重复」的端口。
	 * @param {Array<number|string>} [exclude] 全部已占用端口（跨传输方式）
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
	 *   UUID → NAME → SHOW_LOG → CFIP → CFPORT → HY2_PORT → TUIC_PORT → REALITY_PORT → S5_PORT →
	 *   ANYTLS_PORT → ANYREALITY_PORT → ARGO_PORT → ARGO_DOMAIN → ARGO_AUTH
	 *   ，未启用 Argo 时末位为 DISABLE_ARGO=true。
	 * 其中 NAME 仅在填写时出现（留空不输出）；
	 * SHOW_LOG 仅在**关闭日志输出**时出现（默认开启 → 完全不输出，沿用脚本默认）；
	 * CFIP / CFPORT / ARGO_PORT / ARGO_DOMAIN / ARGO_AUTH 仅在 Argo 启用时出现；
	 * DISABLE_ARGO=true 恒在末位、仅 Argo 删除时出现。
	 * CFPORT 是 CF 节点对外端口，不参与本地监听端口冲突检测。
	 * 端口冲突检测**按传输方式分组**：UDP（hy2 / tuic）与 TCP（reality / s5 / anytls / anyreality / Argo）
	 * 是两套独立的端口空间，只有「同一传输方式 + 同一端口号」才判为 PORT_CONFLICT。
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
		// 端口占用登记表：**按传输方式分组**（UDP / TCP 是两套独立的端口空间）。
		// 结构：transport -> { port(String) -> [keys] }；只有「同一 transport + 同一端口号」
		// 才判为冲突，因此 hy2(UDP) 与 reality(TCP) 用同一个端口号是合法的。
		var portSeen = {};
		TRANSPORTS.forEach(function (t) { portSeen[t] = {}; });
		// 登记一个已占用端口到其所属传输分组（内部辅助，无副作用，仅供本函数使用）。
		function notePort(transport, portValue, key) {
			var group = portSeen[transport];
			var ps = String(portValue);
			if (!group[ps]) { group[ps] = []; }
			group[ps].push(key);
		}

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

		// 0.6) SHOW_LOG —— 日志输出开关，紧跟 NAME、位于 CFIP 之前（与 UI 位置「NAME 下面」对应）。
		// 脚本默认开启日志输出，故**开启时完全不输出**该变量（首屏命令保持最短）；
		// 仅当用户关闭日志输出时输出 `SHOW_LOG=false`（用脚本同样认的规范布尔字面量，更专业）。
		// 判定用 `state.showLog === false`：undefined / null 一律视为开启，
		// 这样既有的旧测试夹具（未带 showLog 字段）不会变红。
		// 与 DISABLE_ARGO 同属「仅在非默认态出现」的范式；且是**全局**变量，与 Argo 是否启用无关。
		if (state && state.showLog === false) {
			vars.push({ name: "SHOW_LOG", value: "false", raw: "false" });
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
			// 按该协议所属的传输方式归组登记（hy2/tuic → udp；其余直连 → tcp）。
			notePort(def.transport, res.value, key);
			vars.push({ name: def.varName, value: String(res.value), raw: String(res.value) });
		});

		// 3) Argo（启用时）：先取端口变量（可留空），再取域名 / 密钥
		var argoPortIsDefault = false; // 端口留空 → 脚本自身会用 ARGO_DEFAULT_PORT
		if (hasArgo) {
			var argoPortRaw = (argo.port === undefined || argo.port === null) ? "" : String(argo.port);
			if (argoPortRaw === "" || /^\s+$/.test(argoPortRaw)) {
				// 端口留空合法：不输出 ARGO_PORT，脚本自身会用默认 8001。
				// 但**必须把该默认端口登记进 TCP 分组** —— 「留空」不等于「不占端口」，
				// 否则用户把某个 TCP 直连协议手工填成 8001 时会漏掉冲突，生成一条实际打架的命令。
				// （Argo 用的是 TCP，故只与 TCP 直连协议争用该端口，不与 UDP 冲突。）
				argoPortIsDefault = true;
				fields.argo = { ok: true, message: "" };
				notePort(PROTO_MAP.argo.transport, ARGO_DEFAULT_PORT, "argo");
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
					notePort(PROTO_MAP.argo.transport, apRes.value, "argo");
					vars.push({ name: "ARGO_PORT", value: String(apRes.value), raw: String(apRes.value) });
				}
			}
		}

		// 4) 端口冲突：仅在**同一传输方式**内检测——UDP 与 TCP 是两套独立端口空间，
		//    同号合法共存。含 Argo 端口（TCP）、不含 CFPORT（CF 对外端口，不参与本地监听冲突）。
		TRANSPORTS.forEach(function (transport) {
			var group = portSeen[transport];
			Object.keys(group).forEach(function (portStr) {
				var keys = group[portStr];
				if (keys.length < 2) { return; }
				var names = keys.map(function (k) { return PROTO_MAP[k].name; });
				keys.forEach(function (k, idx) {
					var others = names.filter(function (_, i) { return i !== idx; });
					// Argo 端口留空时输入框本来就是空的，只写「端口与 X 重复」会让人看不懂，
					// 故说明它「留空 = 默认 8001」这一前提。
					if (k === "argo" && argoPortIsDefault) {
						fields[k] = { ok: false, message: "留空时默认用 " + ARGO_DEFAULT_PORT + "，与 " + others.join("、") + " 重复" };
					} else {
						fields[k] = { ok: false, message: "端口与 " + others.join("、") + " 重复" };
					}
				});
				errors.push({
					code: "PORT_CONFLICT",
					fields: keys.slice(),
					// 文案带上传输方式，便于用户理解「为什么同号不报错」。
					message: "端口冲突：" + names.join(" 与 ") + " 都使用了 " + transport.toUpperCase() + " 端口 " + portStr + "，请改成不同的端口。"
				});
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
		ARGO_DEFAULT_PORT: ARGO_DEFAULT_PORT,
		RATING_MAX: RATING_MAX,
		RATING_STEP: RATING_STEP,
		NAME_MAX: NAME_MAX,
		SCRIPT_CMD: SCRIPT_CMD,
		STOP_CMD: STOP_CMD,
		SUB_CMD: SUB_CMD,
		PROTOCOLS: PROTOCOLS,
		PROTO_MAP: PROTO_MAP,
		PANEL_ORDER: PANEL_ORDER,
		CARD_ORDER: CARD_ORDER,
		orderedKeys: orderedKeys,
		PORT_ORDER: PORT_ORDER,
		VAR_ORDER: VAR_ORDER,
		createInitialState: createInitialState,
		validatePort: validatePort,
		validateUuid: validateUuid,
		validateName: validateName,
		normalizeRating: normalizeRating,
		starFills: starFills,
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
