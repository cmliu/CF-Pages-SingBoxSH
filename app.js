/* ============================================================
 * app.js — 界面层：渲染、交互、持久化、主题、复制
 * 依赖 core.js 暴露的 globalThis.SingBoxCore。
 * 使用普通 <script src>（非 module），以便 file:// 双击打开也能运行。
 * ============================================================ */
(function () {
	"use strict";

	var Core = window.SingBoxCore;
	var STORAGE_KEY = "singbox-sh-generator.v2";

	// 主题只保留两态：light / dark。
	var SUN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>';
	var MOON_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

	// 图标：端口输入框内嵌「随机」= Lucide rotate-cw 循环箭头（16px，比骰子在 15px 下更易辨识）；
	// 「移除节点」= 垃圾桶（16px，与循环箭头同尺寸，保证两个 36px 按钮等宽）。
	var REROLL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>';
	var TRASH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';

	var state = Core.createInitialState();
	var themeMode = "light";   // 由 resolveTheme() 决定，见下
	var argoOpen = false;      // Argo「高级设置」折叠状态
	var uuidAdvOpen = false;   // UUID 卡片「高级设置」（NAME）折叠状态（与 argoOpen 互不影响）
	var panelOpen = false;     // 添加节点面板是否展开
	var els = {};

	/* ---------------- 持久化 ---------------- */

	function loadSaved() {
		try {
			var raw = window.localStorage.getItem(STORAGE_KEY);
			if (!raw) { return null; }
			var data = JSON.parse(raw);
			return data && typeof data === "object" ? data : null;
		} catch (e) {
			return null;
		}
	}

	function save() {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
				uuid: state.uuid,
				name: state.name,
				nodes: state.nodes,
				theme: themeMode
			}));
		} catch (e) { /* 忽略隐私模式等写入失败 */ }
	}

	function applySaved(saved) {
		if (!saved || typeof saved !== "object") { return; }
		if (typeof saved.uuid === "string" && saved.uuid !== "") {
			state.uuid = saved.uuid;
		}
		// 向后兼容：旧的 localStorage 数据没有 name 字段
		if (typeof saved.name === "string") {
			state.name = saved.name;
		}
		var sn = saved.nodes;
		if (!sn || typeof sn !== "object") { return; }
		Object.keys(Core.PROTO_MAP).forEach(function (key) {
			var def = Core.PROTO_MAP[key];
			var incoming = sn[key];
			if (!incoming || typeof incoming !== "object") { return; }
			var node = state.nodes[key];
			node.enabled = !!incoming.enabled;
			if (incoming.port !== undefined && incoming.port !== null) { node.port = incoming.port; }
			if (def.kind === "argo") {
				if (typeof incoming.domain === "string") { node.domain = incoming.domain; }
				if (typeof incoming.auth === "string") { node.auth = incoming.auth; }
				if (typeof incoming.cfip === "string") { node.cfip = incoming.cfip; }
				if (typeof incoming.cfport === "string") { node.cfport = incoming.cfport; }
			}
		});
	}

	/* ---------------- 工具 ---------------- */

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) { node.className = className; }
		if (text !== undefined && text !== null) { node.textContent = text; }
		return node;
	}

	/**
	 * 收集当前**全部**已占用端口，供端口随机按钮 / addNode() 避开。
	 * 刻意**不按传输方式过滤**：UDP 与 TCP 虽可在同号端口合法共存，但随机时应避开
	 * 任何已用端口（哪怕只是另一种传输方式上用过），以免生成「看起来重复」的端口。
	 * Argo 端口留空时补上脚本默认的 ARGO_DEFAULT_PORT（与 core.js 冲突口径一致）。
	 * @returns {Array<number>}
	 */
	function usedPorts() {
		var out = [];
		Core.PORT_ORDER.forEach(function (key) {
			var n = state.nodes[key];
			if (n && n.enabled) {
				var v = Core.validatePort(n.port);
				if (v.ok) { out.push(v.value); }
			}
		});
		var a = state.nodes.argo;
		if (a && a.enabled) {
			var av = Core.validatePort(a.port);
			if (av.ok) {
				out.push(av.value);
			} else {
				// Argo 端口留空 = 脚本会用默认 8001，故该端口同样视为已占用
				// （与 core.js 的冲突检测口径保持一致）。
				out.push(Core.ARGO_DEFAULT_PORT);
			}
		}
		return out;
	}

	var toastTimer = null;
	function toast(msg) {
		els.toast.textContent = msg;
		els.toast.classList.add("show");
		if (toastTimer) { window.clearTimeout(toastTimer); }
		toastTimer = window.setTimeout(function () { els.toast.classList.remove("show"); }, 2000);
	}

	/* ---------------- 主题 ---------------- */

	function systemPrefersDark() {
		try {
			return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
		} catch (e) {
			return false;
		}
	}

	// 首次进入按系统主题；之后按 localStorage 缓存优先。
	function resolveTheme(saved) {
		if (saved && (saved.theme === "light" || saved.theme === "dark")) { return saved.theme; }
		return systemPrefersDark() ? "dark" : "light";
	}

	function setThemeAttribute() {
		document.documentElement.setAttribute("data-theme", themeMode);
	}

	function renderThemeButton() {
		if (!els.themeBtn) { return; }
		var isDark = themeMode === "dark";
		els.themeBtn.innerHTML = isDark ? MOON_SVG : SUN_SVG;
		var label = isDark ? "当前深色主题，点击切换到浅色主题" : "当前浅色主题，点击切换到深色主题";
		els.themeBtn.setAttribute("aria-label", label);
		els.themeBtn.setAttribute("title", label);
	}

	function applyTheme() {
		setThemeAttribute();
		renderThemeButton();
	}

	function toggleTheme() {
		themeMode = themeMode === "dark" ? "light" : "dark";
		applyTheme();
		save();
	}

	/* ---------------- UUID ---------------- */

	function handleUuidInput() {
		state.uuid = els.uuidInput.value;
		// 用户手动清空 → 自动重新生成一个 UUIDv4 并回填（轻提示）
		if (els.uuidInput.value === "") {
			var nu = Core.randomUuid();
			state.uuid = nu;
			els.uuidInput.value = nu;
			toast("UUID 已重新生成");
		}
		save();
		refreshOutput();
	}

	function randomizeUuid() {
		var nu = Core.randomUuid();
		state.uuid = nu;
		els.uuidInput.value = nu;
		save();
		refreshOutput();
		toast("已生成新的 UUID");
		els.uuidInput.focus();
	}

	/**
	 * 把 UUID 卡片的状态同步到 DOM：
	 *   state.uuid → #uuidInput；state.name → #nameInput；uuidAdvOpen → 折叠面板 / aria-expanded。
	 * init() 与 resetAll() 各调用一次，避免漏同步。
	 */
	function syncUuidSection() {
		if (els.uuidInput) { els.uuidInput.value = state.uuid || ""; }
		if (els.nameInput) { els.nameInput.value = state.name || ""; }
		if (els.uuidAdvPanel) { els.uuidAdvPanel.hidden = !uuidAdvOpen; }
		if (els.uuidAdvToggle) { els.uuidAdvToggle.setAttribute("aria-expanded", uuidAdvOpen ? "true" : "false"); }
	}

	// 「高级设置」折叠切换（NAME）
	function toggleUuidAdv() {
		uuidAdvOpen = !uuidAdvOpen;
		syncUuidSection();
	}

	function handleNameInput() {
		state.name = els.nameInput.value;
		save();
		refreshOutput();
	}

	/* ---------------- 卡片渲染 ---------------- */

	function renderCards() {
		els.cardList.textContent = "";
		Core.CARD_ORDER.forEach(function (key) {
			var node = state.nodes[key];
			if (!node || !node.enabled) { return; }
			els.cardList.appendChild(buildCard(key, node));
		});
	}

	function buildCard(key, node) {
		var def = Core.PROTO_MAP[key];
		var card = el("article", "card");
		card.setAttribute("data-key", key);

		// header：信息区 → 端口区 → 操作区（三者同处一行，窄屏自然换行）
		var head = el("div", "card-head");

		var info = el("div", "card-info");
		var titleRow = el("div", "card-title-row");
		titleRow.appendChild(el("h3", "card-name", def.name));
		// 气泡按传输类别分色：UDP / TCP / Argo（三类互不相同，不靠文案判断）
		titleRow.appendChild(el("span", "tag " + def.tagClass, def.tag));
		info.appendChild(titleRow);
		info.appendChild(el("p", "card-desc", def.desc));

		var portGroup = buildPortGroup(key, node);

		var actions = el("div", "card-actions");
		var delBtn = el("button", "card-btn card-btn-del");
		delBtn.type = "button";
		var delLabel = "移除 " + def.name + " 节点";
		delBtn.setAttribute("aria-label", delLabel);
		delBtn.setAttribute("title", delLabel);
		delBtn.innerHTML = TRASH_SVG + '<span class="card-btn-text">移除节点</span>';
		delBtn.addEventListener("click", function () { deleteNode(key); });
		actions.appendChild(delBtn);

		head.appendChild(info);
		head.appendChild(portGroup);
		head.appendChild(actions);
		card.appendChild(head);

		// 仅在有错误时渲染的错误行（无错误时不占高度）
		var errRow = el("p", "field-error");
		errRow.id = "err-" + key;
		errRow.hidden = true;
		card.appendChild(errRow);

		// Argo：高级设置（固定隧道 / CF 优选）可折叠，默认折叠
		if (def.kind === "argo") {
			var toggle = el("button", "adv-toggle", "高级设置");
			toggle.type = "button";
			toggle.setAttribute("aria-expanded", argoOpen ? "true" : "false");

			var panel = el("div", "adv-panel");
			panel.hidden = !argoOpen;
			panel.appendChild(buildArgoFields());

			toggle.addEventListener("click", function () {
				argoOpen = !argoOpen;
				panel.hidden = !argoOpen;
				toggle.setAttribute("aria-expanded", argoOpen ? "true" : "false");
			});

			card.appendChild(toggle);
			card.appendChild(panel);
		}

		return card;
	}

	/**
	 * 构建卡片端口组：可见 label（「端口：」）+ 输入框（内部右侧内嵌「随机」图标按钮）。
	 * 输入框高度与卡片按钮（移除节点）保持一致。
	 * @param {string} key
	 * @param {Object} node
	 * @returns {HTMLElement}
	 */
	function buildPortGroup(key, node) {
		var def = Core.PROTO_MAP[key];
		var group = el("div", "card-port");

		var label = el("label", "port-label", "端口：");
		label.setAttribute("for", "port-" + key);

		var field = el("span", "port-field");

		var input = el("input", "text-input port-input");
		input.type = "text";
		input.id = "port-" + key;
		input.setAttribute("inputmode", "numeric");
		input.setAttribute("autocomplete", "off");
		input.setAttribute("spellcheck", "false");
		input.setAttribute("maxlength", "5");
		// Argo 端口默认留空：用 placeholder 提示「留空时脚本会用 8001」，而不是预填一个 8001。
		// 这样一个字都不改时，命令里就不会出现 ARGO_PORT，首屏命令最短。
		if (def.kind === "argo") {
			input.setAttribute("placeholder", String(Core.ARGO_DEFAULT_PORT));
		}
		input.value = node.port === undefined || node.port === null ? "" : String(node.port);
		input.addEventListener("input", function () {
			state.nodes[key].port = input.value;
			save();
			refreshOutput();
		});

		// 内嵌「随机」按钮：真正的 <button>，键盘可达；图标 aria-hidden。
		var reroll = el("button", "port-reroll");
		reroll.type = "button";
		var rerollLabel = "为 " + def.name + " 随机一个端口";
		reroll.setAttribute("aria-label", rerollLabel);
		reroll.setAttribute("title", rerollLabel);
		reroll.innerHTML = REROLL_SVG;
		// 鼠标按下时阻止默认行为：点图标不夺走输入框焦点，页面也不跳动。
		reroll.addEventListener("mousedown", function (e) { e.preventDefault(); });
		reroll.addEventListener("click", function () {
			var p = Core.randomPort(usedPorts());
			state.nodes[key].port = String(p);
			input.value = String(p);
			save();
			refreshOutput();
			input.focus({ preventScroll: true });
		});

		field.appendChild(input);
		field.appendChild(reroll);
		group.appendChild(label);
		group.appendChild(field);
		return group;
	}

	/**
	 * 计算 Argo 固定隧道区的提示文案（纯 UI 提示，不参与命令生成）。
	 * 脚本规则：ARGO_DOMAIN 与 ARGO_AUTH 任一为空 → 自动改用临时隧道。
	 * @returns {{text:string, warn:boolean}|null} null 表示无需提示
	 */
	function computeArgoHint() {
		var domain = Core.cleanValue(state.nodes.argo.domain);
		var auth = Core.cleanValue(state.nodes.argo.auth);
		if (domain && auth) {
			return null;
		}
		if (!domain && !auth) {
			return { text: "两项都留空时使用临时隧道（脚本自动分配域名）", warn: false };
		}
		return {
			text: "固定隧道需要域名和密钥同时填写，只填一项脚本仍会使用临时隧道",
			warn: true
		};
	}

	/**
	 * 把提示写入具体元素；不传参时按 id 查找（用于面板重建后的刷新）。
	 * @param {HTMLElement} [target]
	 */
	function applyArgoHint(target) {
		var hintEl = target || document.getElementById("argo-hint");
		if (!hintEl) { return; }
		var info = computeArgoHint();
		if (!info) {
			hintEl.hidden = true;
			hintEl.textContent = "";
			hintEl.classList.remove("hint-warn");
			return;
		}
		hintEl.hidden = false;
		hintEl.textContent = info.text;
		hintEl.classList.toggle("hint-warn", info.warn);
	}

	function buildArgoFields() {
		var wrap = el("div", "adv-groups");

		// 组 1：固定隧道（可选）
		var g1 = el("div", "field-group");
		g1.appendChild(el("p", "group-title", "固定隧道（可选）"));

		var dField = el("div", "field");
		var dLabel = el("label", "field-label", "固定隧道域名");
		dLabel.setAttribute("for", "domain-argo");
		var dInput = el("input", "text-input adv-input");
		dInput.type = "text";
		dInput.id = "domain-argo";
		dInput.setAttribute("placeholder", "例如 tunnel.example.com（留空则不用）");
		dInput.setAttribute("autocomplete", "off");
		dInput.setAttribute("spellcheck", "false");
		dInput.value = state.nodes.argo.domain || "";
		dInput.addEventListener("input", function () {
			state.nodes.argo.domain = dInput.value;
			save();
			refreshOutput();
		});
		dField.appendChild(dLabel);
		dField.appendChild(dInput);

		var aField = el("div", "field");
		var aLabel = el("label", "field-label", "隧道密钥");
		aLabel.setAttribute("for", "auth-argo");
		var aInput = el("input", "text-input adv-input");
		aInput.type = "text";
		aInput.id = "auth-argo";
		aInput.setAttribute("placeholder", "粘贴 token 或 json（留空则不用）");
		aInput.setAttribute("autocomplete", "off");
		aInput.setAttribute("spellcheck", "false");
		aInput.value = state.nodes.argo.auth || "";
		aInput.addEventListener("input", function () {
			state.nodes.argo.auth = aInput.value;
			save();
			refreshOutput();
		});
		aField.appendChild(aLabel);
		aField.appendChild(aInput);

		// 动态提示：按「域名/密钥是否都填」展示不同文案（仅 UI 提示，不影响命令生成）
		var hint = el("p", "argo-hint");
		hint.id = "argo-hint";

		g1.appendChild(dField);
		g1.appendChild(aField);
		g1.appendChild(hint);
		applyArgoHint(hint);

		// 组 2：CF 优选（可选）—— 两个都留空则不输出
		var g2 = el("div", "field-group");
		g2.appendChild(el("p", "group-title", "CF 优选（可选）"));

		var cField = el("div", "field");
		var cLabel = el("label", "field-label", "CFIP（优选域名 / IP）");
		cLabel.setAttribute("for", "cfip-argo");
		var cInput = el("input", "text-input adv-input");
		cInput.type = "text";
		cInput.id = "cfip-argo";
		cInput.setAttribute("placeholder", "例如 mfa.gov.ua（留空用脚本默认）");
		cInput.setAttribute("autocomplete", "off");
		cInput.setAttribute("spellcheck", "false");
		cInput.value = state.nodes.argo.cfip || "";
		cInput.addEventListener("input", function () {
			state.nodes.argo.cfip = cInput.value;
			save();
			refreshOutput();
		});
		cField.appendChild(cLabel);
		cField.appendChild(cInput);

		var cpField = el("div", "field");
		var cpLabel = el("label", "field-label", "CFPORT（优选端口）");
		cpLabel.setAttribute("for", "cfport-argo");
		var cpInput = el("input", "text-input adv-input");
		cpInput.type = "text";
		cpInput.id = "cfport-argo";
		cpInput.setAttribute("inputmode", "numeric");
		cpInput.setAttribute("autocomplete", "off");
		cpInput.setAttribute("spellcheck", "false");
		cpInput.setAttribute("maxlength", "5");
		cpInput.setAttribute("placeholder", "例如 443（留空用脚本默认）");
		cpInput.value = state.nodes.argo.cfport || "";
		cpInput.addEventListener("input", function () {
			state.nodes.argo.cfport = cpInput.value;
			save();
			refreshOutput();
		});
		cpField.appendChild(cpLabel);
		cpField.appendChild(cpInput);

		// CFPORT 仅在有错误时渲染的错误行（无错误时不占高度）
		var cpErr = el("p", "field-error");
		cpErr.id = "err-cfport";
		cpErr.hidden = true;

		g2.appendChild(cField);
		g2.appendChild(cpField);
		g2.appendChild(cpErr);

		wrap.appendChild(g1);
		wrap.appendChild(g2);
		return wrap;
	}

	/* ---------------- 增删节点 ---------------- */

	function addNode(key) {
		var node = state.nodes[key];
		if (!node || node.enabled) { return; }
		node.enabled = true;
		if (Core.PROTO_MAP[key].kind === "argo") {
			// Argo 端口保持留空（= 脚本默认 8001）；仅当已有残留值时才沿用。
			if (node.port === undefined || node.port === null) { node.port = ""; }
			argoOpen = false;
		} else {
			node.port = String(Core.randomPort(usedPorts()));
		}
		save();
		renderCards();
		refreshOutput();
		closePanel(false);
		var input = document.getElementById("port-" + key);
		if (input) { input.focus(); } else { els.addBtn.focus(); }
	}

	function deleteNode(key) {
		state.nodes[key].enabled = false;
		if (key === "argo") { argoOpen = false; }
		save();
		renderCards();
		refreshOutput();
		els.addBtn.focus();
	}

	function resetAll() {
		state = Core.createInitialState();
		argoOpen = false;
		uuidAdvOpen = false;
		// 复位 UUID 卡片（UUID / NAME 输入框 + 折叠态）——refreshOutput() 随后清空 NAME 错误行
		syncUuidSection();
		save();
		renderCards();
		refreshOutput();
		toast("已重置为初始状态");
	}

	/* ---------------- 输出区 ---------------- */

	function setCopyDisabled(disabled) {
		els.copyBtn.disabled = !!disabled;
		els.copyBtn.setAttribute("aria-disabled", disabled ? "true" : "false");
	}

	/**
	 * 把「错误行」同步为给定状态：有错则显示中文原因，无错则清空并隐藏（不占高度）。
	 * @param {HTMLElement|null} node
	 * @param {{ok:boolean, message:string}|undefined} field
	 */
	function setErrorRow(node, field) {
		if (!node) { return; }
		var bad = !!(field && field.ok === false);
		if (bad) {
			node.textContent = field.message;
			node.hidden = false;
		} else {
			node.textContent = "";
			node.hidden = true;
		}
	}

	function refreshOutput() {
		var result = Core.buildCommand(state);

		// UUID 校验态（错误行仅在有错时出现）
		var uf = result.fields.uuid;
		var uBad = !!(uf && uf.ok === false);
		els.uuidInput.classList.toggle("invalid", uBad);
		els.uuidInput.setAttribute("aria-invalid", uBad ? "true" : "false");
		setErrorRow(els.uuidError, uf);

		// NAME 校验态（错误行仅在有错时出现）
		var nf = result.fields.name;
		var nBad = !!(nf && nf.ok === false);
		if (els.nameInput) {
			els.nameInput.classList.toggle("invalid", nBad);
			els.nameInput.setAttribute("aria-invalid", nBad ? "true" : "false");
		}
		setErrorRow(els.nameError, nf);

		// 端口输入框的校验态（含 Argo）
		var portKeys = Core.PORT_ORDER.slice();
		if (state.nodes.argo && state.nodes.argo.enabled) { portKeys.push("argo"); }
		portKeys.forEach(function (key) {
			var input = document.getElementById("port-" + key);
			var f = result.fields[key];
			var bad = !!(f && f.ok === false);
			if (input) {
				input.classList.toggle("invalid", bad);
				input.setAttribute("aria-invalid", bad ? "true" : "false");
			}
			setErrorRow(document.getElementById("err-" + key), f);
		});

		// CFPORT 校验态（仅 Argo 启用时存在）
		if (state.nodes.argo && state.nodes.argo.enabled) {
			var cfInput = document.getElementById("cfport-argo");
			var cfField = result.fields.cfport;
			var cbBad = !!(cfField && cfField.ok === false);
			if (cfInput) {
				cfInput.classList.toggle("invalid", cbBad);
				cfInput.setAttribute("aria-invalid", cbBad ? "true" : "false");
			}
			setErrorRow(document.getElementById("err-cfport"), cfField);
		}

		// 命令区
		els.cmdBox.textContent = "";
		if (result.ok) {
			els.cmdBox.classList.remove("is-empty");
			result.parts.forEach(function (p) {
				els.cmdBox.appendChild(el("span", "t-" + p.type, p.text));
			});
			setCopyDisabled(false);
		} else {
			els.cmdBox.classList.add("is-empty");
			var isEmpty = result.errors.some(function (e) { return e.code === "EMPTY"; });
			els.cmdBox.textContent = isEmpty ? "至少启用一个节点" : "请先按提示修正下面的问题";
			setCopyDisabled(true);
		}

		// 警告提示
		els.warnBox.textContent = "";
		if (!result.ok) {
			result.errors.forEach(function (e) {
				els.warnBox.appendChild(el("p", "warn-line", e.message));
			});
		}

		// Argo 固定隧道区的动态提示（纯 UI，不影响 result.ok / result.command）
		applyArgoHint();

		els.copyFeedback.textContent = "";
	}

	/* ---------------- 复制 ---------------- */

	function fallbackCopy(text) {
		try {
			var ta = document.createElement("textarea");
			ta.value = text;
			ta.setAttribute("readonly", "");
			ta.style.position = "fixed";
			ta.style.top = "-1000px";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			var ok = document.execCommand("copy");
			document.body.removeChild(ta);
			return ok;
		} catch (e) {
			return false;
		}
	}

	function copyText(text) {
		return new Promise(function (resolve) {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				navigator.clipboard.writeText(text).then(
					function () { resolve(true); },
					function () { resolve(fallbackCopy(text)); }
				);
			} else {
				resolve(fallbackCopy(text));
			}
		});
	}

	var copyTimer = null;
	function doCopy() {
		var result = Core.buildCommand(state);
		if (!result.ok) { return; }
		copyText(result.command).then(function (success) {
			if (success) {
				els.copyBtn.textContent = "已复制";
				els.copyBtn.classList.add("is-copied");
				els.copyFeedback.textContent = "命令已复制到剪贴板，去 VPS 粘贴运行吧。";
				if (copyTimer) { window.clearTimeout(copyTimer); }
				copyTimer = window.setTimeout(function () {
					els.copyBtn.textContent = "复制";
					els.copyBtn.classList.remove("is-copied");
				}, 1800);
			} else {
				els.copyFeedback.textContent = "复制失败，请手动选中命令后复制。";
			}
		});
	}

	var stopTimer = null;
	function doStopCopy() {
		copyText(Core.STOP_CMD).then(function (success) {
			if (success) {
				els.stopCopyBtn.textContent = "已复制";
				els.stopCopyBtn.classList.add("is-copied");
				els.stopFeedback.textContent = "停止命令已复制。";
				if (stopTimer) { window.clearTimeout(stopTimer); }
				stopTimer = window.setTimeout(function () {
					els.stopCopyBtn.textContent = "复制";
					els.stopCopyBtn.classList.remove("is-copied");
				}, 1800);
			} else {
				els.stopFeedback.textContent = "复制失败，请手动选中命令后复制。";
			}
		});
	}

	/* ---------------- 添加节点面板 ---------------- */

	function renderPanel() {
		els.panel.textContent = "";
		Core.PANEL_ORDER.forEach(function (key) {
			var def = Core.PROTO_MAP[key];
			var added = !!state.nodes[key].enabled;
			var item = el("button", "add-item");
			item.type = "button";
			item.setAttribute("role", "menuitem");
			item.appendChild(el("span", "add-item-name", def.name));
			item.appendChild(el("span", "add-item-desc", def.panelDesc));
			item.appendChild(el("span", "add-item-tag", added ? "已添加" : "添加"));
			if (added) {
				item.disabled = true;
				item.setAttribute("aria-disabled", "true");
			} else {
				item.addEventListener("click", function () { addNode(key); });
			}
			els.panel.appendChild(item);
		});
	}

	function openPanel() {
		panelOpen = true;
		renderPanel();
		els.panel.hidden = false;
		els.addBtn.setAttribute("aria-expanded", "true");
		var first = els.panel.querySelector(".add-item:not(:disabled)");
		if (first) { first.focus(); }
	}

	function closePanel(returnFocus) {
		panelOpen = false;
		els.panel.hidden = true;
		els.addBtn.setAttribute("aria-expanded", "false");
		if (returnFocus) { els.addBtn.focus(); }
	}

	/* ---------------- 初始化 ---------------- */

	function init() {
		els = {
			cardList: document.getElementById("cardList"),
			addWrap: document.getElementById("addWrap"),
			addBtn: document.getElementById("addBtn"),
			panel: document.getElementById("addPanel"),
			cmdBox: document.getElementById("cmdBox"),
			warnBox: document.getElementById("warnBox"),
			copyBtn: document.getElementById("copyBtn"),
			copyFeedback: document.getElementById("copyFeedback"),
			uuidInput: document.getElementById("uuidInput"),
			uuidRandomBtn: document.getElementById("uuidRandomBtn"),
			uuidError: document.getElementById("uuidError"),
			uuidAdvToggle: document.getElementById("uuidAdvToggle"),
			uuidAdvPanel: document.getElementById("uuidAdvPanel"),
			nameInput: document.getElementById("nameInput"),
			nameError: document.getElementById("nameError"),
			stopBox: document.getElementById("stopBox"),
			stopCopyBtn: document.getElementById("stopCopyBtn"),
			stopFeedback: document.getElementById("stopFeedback"),
			themeBtn: document.getElementById("themeBtn"),
			resetBtn: document.getElementById("resetBtn"),
			toast: document.getElementById("toast")
		};

		var saved = loadSaved();
		themeMode = resolveTheme(saved);
		applySaved(saved);

		// 主题按钮图标 / 无障碍标签 + 文档主题属性
		applyTheme();

		// 「随机生成」按钮：注入循环箭头图标 + 文字（图标 aria-hidden，可读名称靠 aria-label）
		if (els.uuidRandomBtn) {
			els.uuidRandomBtn.innerHTML = REROLL_SVG + '<span class="icon-btn-text">随机生成</span>';
		}

		// 同步 UUID 卡片（UUID / NAME 输入框 + 折叠态）、停止命令到界面
		syncUuidSection();
		els.stopBox.textContent = Core.STOP_CMD;

		els.addBtn.addEventListener("click", function (e) {
			e.stopPropagation();
			if (panelOpen) { closePanel(true); } else { openPanel(); }
		});

		els.panel.addEventListener("click", function (e) { e.stopPropagation(); });

		document.addEventListener("click", function (e) {
			if (!panelOpen) { return; }
			if (!els.addWrap.contains(e.target)) { closePanel(false); }
		});

		document.addEventListener("keydown", function (e) {
			if (e.key === "Escape" && panelOpen) { closePanel(true); }
		});

		els.uuidInput.addEventListener("input", handleUuidInput);
		els.uuidRandomBtn.addEventListener("click", randomizeUuid);
		els.uuidAdvToggle.addEventListener("click", toggleUuidAdv);
		els.nameInput.addEventListener("input", handleNameInput);
		els.copyBtn.addEventListener("click", doCopy);
		els.stopCopyBtn.addEventListener("click", doStopCopy);
		els.themeBtn.addEventListener("click", toggleTheme);
		els.resetBtn.addEventListener("click", resetAll);

		renderCards();
		refreshOutput();

		// 首次访问（无缓存）时把生成的 UUID 落盘。
		save();
	}

	// 尽早应用主题，减少闪烁（此时 documentElement 已存在）。
	var earlySaved = loadSaved();
	themeMode = resolveTheme(earlySaved);
	setThemeAttribute();

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
