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
	// 「复制命令」按钮的两个状态图标（Lucide copy / check，16px，stroke=currentColor）：
	// 成功态换成对勾 —— 让状态**不只靠颜色**表达（无障碍要求），并同时改文案「复制命令」→「已复制」。
	var COPY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
	var CHECK_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"></path></svg>';
	var COPY_LABEL = "复制命令";   // 默认态文案（与 index.html 内联默认一致；app.js 为运行时唯一真源）
	var COPIED_LABEL = "已复制"; // 成功态文案（约 1.8s 后复原）

	/* ---------- 推荐指数星星（纯 SVG，跨设备/字体一致） ----------
	 * 为什么不用「★★★★☆」这类字符：星形的字形在各平台/字体里差异很大（有的圆角有的尖角、
	 * 有的还是 emoji 彩色星），半星更是只能靠「⯨」之类的冷门字符，很多设备直接缺字变豆腐块。
	 * SVG 能保证形状、大小、半星比例在所有设备上完全一致。
	 * 半星实现：每颗星 =「描边空星」背景层 +「实心星」前景层，前景层用 CSS 宽度(0/50/100%) +
	 * overflow:hidden 裁剪。刻意**不用** SVG <clipPath> / <linearGradient> —— 那些要唯一 id，
	 * 面板里 7 行 × 5 颗会互相冲突；也不用 CSS clip-path，少一层兼容性依赖。 */
	var STAR_PATH = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
	var STAR_SIZE = 11;   // 单颗星的边长（px）；改这个必须同步 style.css 的 .star 宽高
	function starSvg(filled) {
		return '<svg viewBox="0 0 24 24" width="' + STAR_SIZE + '" height="' + STAR_SIZE + '" aria-hidden="true" focusable="false" ' +
			(filled ? 'fill="currentColor"' : 'fill="none"') +
			' stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="' + STAR_PATH + '"></path></svg>';
	}

	/**
	 * 按推荐指数渲染 5 颗星（支持半星）。
	 * 指数本身由 `core.js` 的 `starFills()` 归一化（钳到 0–5、吸附到 0.5），所以这里只负责画。
	 * 无障碍：整组用 role="img" + aria-label（"推荐指数 4.5 / 5 星"），里面的 SVG 全部 aria-hidden。
	 * @param {number} rating 推荐指数（0–5，可含 0.5）
	 * @returns {HTMLElement}
	 */
	function buildRating(rating) {
		var fills = Core.starFills(rating);
		var value = Core.normalizeRating(rating);
		var label = "推荐指数 " + value + " / " + Core.RATING_MAX + " 星";
		var wrap = el("span", "stars");
		wrap.setAttribute("role", "img");
		wrap.setAttribute("aria-label", label);
		wrap.setAttribute("title", label);
		fills.forEach(function (fill) {
			var cls = fill >= 1 ? " is-full" : (fill > 0 ? " is-half" : " is-empty");
			var star = el("span", "star" + cls);
			star.innerHTML = starSvg(false);      // 背景层：描边空星
			if (fill > 0) {
				var fg = el("span", "star-fill");
				fg.innerHTML = starSvg(true);   // 前景层：实心星，被父层宽度裁掉右半边
				star.appendChild(fg);           // 前景层宽度（100% / 50%）由 style.css 的状态类给
			}
			wrap.appendChild(star);
		});
		return wrap;
	}

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
				showLog: state.showLog,
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
		// 向后兼容：旧的 localStorage 数据没有 showLog 字段 → 保持默认开启（true）。
		// 只在确为布尔值时才覆盖，避免脏值（如字符串 "false"）把开关带偏。
		if (typeof saved.showLog === "boolean") {
			state.showLog = saved.showLog;
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

	/* ---------------- 工具栏按钮点击反馈 ---------------- */

	// 三个一次性反馈类，与 style.css 的 .is-pulse-* 一一对应（每颗按钮各一个）。
	var PULSE_CLASSES = ["is-pulse-theme", "is-pulse-all", "is-pulse-reset"];
	// 兜底清理时长：必须**大于**最长的一条动画（tb-rewind .4s），否则动画还没结束就把类摘了。
	var PULSE_FALLBACK_MS = 600;
	var pulseTimers = {};   // 以类名为键（每类只对应一颗按钮），避免连点叠加定时器

	/**
	 * 给按钮触发一次性的「已点击」反馈动效：重放 .is-pulse-* 类，让 CSS animation 从头播一次。
	 *
	 * 为什么是「先 remove → 强制回流 → 再 add」：
	 *   若元素上已经挂着同名类，浏览器会认为类名没变、**不会重新开始**动画 →
	 *   连续快速点击时，第二次及以后就看不到反馈了（这是本任务最容易漏的点）。
	 *   中间读一次 offsetWidth 会强制样式重算，把「无动画」这一状态落定，随后 add 才能重新触发。
	 *
	 * 清理：animationend 由 init() 里的单一委托监听负责摘类（快速、无监听器叠加）；
	 *   另加一个定时器兜底 —— 因为 reduced-motion 下动画被全局规则禁用、animationend 永远不会触发，
	 *   没有兜底的话类会残留在按钮上。定时器按类名复用，连点只保留最后一个，不会堆积。
	 * @param {HTMLElement} node 目标按钮
	 * @param {string} cls 反馈类名（PULSE_CLASSES 之一）
	 */
	function replayPulse(node, cls) {
		if (!node) { return; }
		node.classList.remove(cls);
		void node.offsetWidth;      // 强制回流：使上面 remove 立即生效，从而 add 能重新触发动画
		node.classList.add(cls);
		if (pulseTimers[cls]) { window.clearTimeout(pulseTimers[cls]); }
		pulseTimers[cls] = window.setTimeout(function () {
			node.classList.remove(cls);
			pulseTimers[cls] = null;
		}, PULSE_FALLBACK_MS);
	}

	/**
	 * 动画结束时摘掉反馈类（单一委托监听，只在 init() 绑定一次，绝不每次点击都叠加监听器）。
	 * 关键：动画宿主有两种 —— #allBtn 的脉冲打在**按钮本体**上，而 #themeBtn / #resetBtn 的图标
	 *   旋转打在**按钮内的 svg** 上，animationend 的 target 会分别是按钮或 svg。反馈类却始终加在
	 *   按钮上，故这里先定位最近的 .theme-btn 宿主再摘类，否则 svg 宿主的事件会摘错对象、类清不掉。
	 * 只摘 PULSE_CLASSES 里的类，所以即使页面里别的元素（如 .card 的 rise 动画）触发 animationend 也不受影响。
	 * @param {AnimationEvent} e
	 */
	function onAnimationEnd(e) {
		var n = e.target;
		if (!n) { return; }
		var host = (n.closest && n.closest(".theme-btn")) || n;
		if (!host.classList) { return; }
		for (var i = 0; i < PULSE_CLASSES.length; i++) {
			host.classList.remove(PULSE_CLASSES[i]);
		}
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
		// 图标表示「**点击后会切换到的主题**」，不是当前主题：
		//   深色时显示太阳（点击 → 浅色）、浅色时显示月亮（点击 → 深色）。
		// 这样图标本身就是动作预览，与 aria-label / title 描述的「切换目标」一致。
		els.themeBtn.innerHTML = isDark ? SUN_SVG : MOON_SVG;
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
	 *   state.uuid → #uuidInput；state.name → #nameInput；state.showLog → #showLogSwitch 的 aria-checked；
	 *   uuidAdvOpen → 折叠面板 / aria-expanded。
	 * init() 与 resetAll() 各调用一次，避免漏同步。
	 * 开关的视觉态完全由 CSS 的 [aria-checked="true"] 驱动，故这里只需同步 aria-checked 一个属性。
	 */
	function syncUuidSection() {
		if (els.uuidInput) { els.uuidInput.value = state.uuid || ""; }
		if (els.nameInput) { els.nameInput.value = state.name || ""; }
		if (els.showLogSwitch) { els.showLogSwitch.setAttribute("aria-checked", state.showLog === false ? "false" : "true"); }
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

	/**
	 * SHOW_LOG（日志输出）开关切换。
	 * 语义（与 core.js 一致）：开启（默认）= 命令里完全不输出 SHOW_LOG（沿用脚本默认）；
	 * 关闭 = 输出 `SHOW_LOG=false`（低配机器更省力）。
	 * 原生 <button role="switch"> 已内建 Enter / Space → click，故无需额外键盘处理。
	 * 视觉态由 [aria-checked] 驱动，经 syncUuidSection() 统一回写。
	 */
	function toggleShowLog() {
		state.showLog = state.showLog === false ? true : false;
		save();
		syncUuidSection();
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
		syncAllBtnsDisabled();
	}

	/**
	 * 「协议已经全部在列」时，把 ALL 与「+ 更多节点协议」两颗按钮一起置灰（不可选）。
	 *
	 * 语义：两颗按钮都只在「还有东西可选」时才成立 —— ALL = 一键全选，「更多节点协议」= 再挑一个。
	 * 7 个节点全启用后它们都是空操作，置灰比「点了没反应」清楚。disabled 与 aria-disabled 同步写
	 * （沿用 setCopyDisabled 的既有写法），键盘 / 读屏拿到的状态一致。
	 * 复位路径：删掉任一节点卡片、或点「重置」→ 都会走 renderCards() 重算 → 两按钮立刻恢复可点。
	 * 面板若正开着也一并收起（否则留下一屏全是「已添加」的死菜单）。
	 *
	 * 挂点选在 renderCards() 末尾：节点的启用与否**只能由卡片增删改变**（卡片是按 enabled 渲染的），
	 * 所有增删路径都必经这里，不会漏更新。
	 * ⚠️ 有意为之的副作用：ALL 按钮同时是彩蛋的触发器，置灰期间浏览器不再派发它的 click，
	 *    所以「已全选」状态下翻不了面 —— 这是 disabled 的应有之义（不是 bug）。
	 */
	function syncAllBtnsDisabled() {
		var full = Core.CARD_ORDER.every(function (key) {
			var node = state.nodes[key];
			return !!(node && node.enabled);
		});
		[els.allBtn, els.addBtn].forEach(function (btn) {
			btn.disabled = full;
			btn.setAttribute("aria-disabled", full ? "true" : "false");
		});
		if (full && panelOpen) { closePanel(false); }
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
		// 推荐指数星星，紧贴在气泡右侧（与「添加节点」面板同款；卡片上是只读展示，不可点）
		titleRow.appendChild(buildRating(def.rating));
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

	/**
	 * 工具栏「ALL」按钮的**彩蛋面**：文本面 ALL ⇄ 「我全都要」梗图马赛克，点一次翻一面。
	 *
	 * 只是 classList.toggle —— 两面同槽层叠（.all-face = absolute inset:0），可见性由 CSS 的
	 * opacity 过渡接管：**不碰尺寸/位置、不切 display**，所以连点不闪、按钮恒 36×36。
	 * 与全选是同一个 click 上的**两个独立 listener**，不是二选一：点一下既全选又翻面。
	 * 禁用 JS 时不执行，按钮停在 HTML 默认的文本面（渐进增强）。
	 */
	function toggleAllBtnEgg() {
		els.allBtn.classList.toggle("is-egg");
	}

	/**
	 * 工具栏「ALL」按钮：一键全选——启用**全部节点**（6 个直连协议 + Argo）。
	 *
	 * 规则：
	 * - 已启用的节点**保持原端口不变**（不打扰用户已填好的值）；
	 * - 新启用的直连协议逐个随机取一个端口，且**每分配一个就重算一次 usedPorts()**，
	 *   因此新端口之间、以及与既有端口都不会重复；
	 * - **Argo 也在全选范围内**（ALL 就是全选）。它按「添加节点」的老规矩走：端口保持**留空**，
	 *   由脚本用默认 8001（输入框以 placeholder 提示），命令里不会多出多余的 ARGO_PORT；
	 *   仅当此前有残留值时才沿用。
	 *   节点处理顺序用 `CARD_ORDER`（Argo 置顶），这样它占用的 8001 会**先**进入已占用集合，
	 *   后面 6 个直连协议的随机端口自然避开它；
	 * - 已经全选时不做任何改动，只给一句轻提示（避免「点了没反应」的困惑）。
	 */
	function enableAllNodes() {
		var pending = Core.CARD_ORDER.filter(function (key) {
			return state.nodes[key] && !state.nodes[key].enabled;
		});
		if (!pending.length) {
			toast("所有节点已经全部启用");
			return;
		}
		pending.forEach(function (key) {
			var node = state.nodes[key];
			node.enabled = true;
			if (Core.PROTO_MAP[key].kind === "argo") {
				// 与 addNode() 的 Argo 分支一致：端口保持留空（= 脚本默认 8001）
				if (node.port === undefined || node.port === null) { node.port = ""; }
				argoOpen = false;
			} else {
				node.port = String(Core.randomPort(usedPorts()));
			}
		});
		save();
		renderCards();
		refreshOutput();
		toast("已全选全部节点（" + Core.CARD_ORDER.length + " 个）");
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

		// 警告提示 —— 与 .field-error 同一条纪律：**仅在有警告时出现，无警告时不占高度**。
		// ⚠️ 必须给空的 #warnBox 加 hidden（CSS 里 .warn-box[hidden]{display:none}）：
		//     它自带 margin-top:10px，若空着也常驻 DOM，只存在于「安装命令」区的它会让
		//     该区「命令框 → 复制命令按钮」多出 10px —— 两个命令区的按钮上下间距就对不齐了
		//     （用户 2026-09-18 报告「两个按钮的上下间距不一致」，实测 安装命令 20px / 停止命令 10px）。
		var hasWarn = !!(result.errors && result.errors.length);
		els.warnBox.textContent = "";
		els.warnBox.hidden = !hasWarn;
		if (hasWarn) {
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

	/**
	 * 设置「复制命令」按钮的状态：copied=false → copy 图标 +「复制命令」；
	 * copied=true → check 图标 +「已复制」并加 .is-copied（实心绿底）。
	 * 图标 aria-hidden、文字是可见文本 → 按钮可访问名称始终正确，且状态不只靠颜色表达。
	 * @param {HTMLElement} btn
	 * @param {boolean} copied
	 */
	function setCopyState(btn, copied) {
		if (!btn) { return; }
		btn.classList.toggle("is-copied", !!copied);
		btn.innerHTML = (copied ? CHECK_SVG : COPY_SVG) + (copied ? COPIED_LABEL : COPY_LABEL);
	}

	var copyTimer = null;
	function doCopy() {
		var result = Core.buildCommand(state);
		if (!result.ok) { return; }
		copyText(result.command).then(function (success) {
			if (success) {
				setCopyState(els.copyBtn, true);
				els.copyFeedback.textContent = "命令已复制到剪贴板，去 VPS 粘贴运行吧。";
				if (copyTimer) { window.clearTimeout(copyTimer); }
				copyTimer = window.setTimeout(function () {
					setCopyState(els.copyBtn, false);
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
				setCopyState(els.stopCopyBtn, true);
				els.stopFeedback.textContent = "停止命令已复制。";
				if (stopTimer) { window.clearTimeout(stopTimer); }
				stopTimer = window.setTimeout(function () {
					setCopyState(els.stopCopyBtn, false);
				}, 1800);
			} else {
				els.stopFeedback.textContent = "复制失败，请手动选中命令后复制。";
			}
		});
	}

	var subTimer = null;
	function doSubCopy() {
		copyText(Core.SUB_CMD).then(function (success) {
			if (success) {
				setCopyState(els.subCopyBtn, true);
				els.subFeedback.textContent = "查看订阅命令已复制。";
				if (subTimer) { window.clearTimeout(subTimer); }
				subTimer = window.setTimeout(function () {
					setCopyState(els.subCopyBtn, false);
				}, 1800);
			} else {
				els.subFeedback.textContent = "复制失败，请手动选中命令后复制。";
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
			// 与上方「已选节点」卡片同构：名称 + 传输类型气泡（tagClass 驱动配色）+ 简介（desc）；
			// 推荐指数星星放同一行的右端（`.stars` 用 margin-left:auto 顶到最右）。
			// 气泡让用户在下拉里就能分辨 UDP / TCP，不必靠「UDP，…」前缀的重复文案。
			var head = el("span", "add-item-head");
			head.appendChild(el("span", "add-item-name", def.name));
			head.appendChild(el("span", "tag " + def.tagClass, def.tag));
			head.appendChild(buildRating(def.rating));
			item.appendChild(head);
			item.appendChild(el("span", "add-item-desc", def.desc));
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
			showLogSwitch: document.getElementById("showLogSwitch"),
			showLogField: document.querySelector("#uuidAdvPanel .switch-field"),
			stopBox: document.getElementById("stopBox"),
			stopCopyBtn: document.getElementById("stopCopyBtn"),
			stopFeedback: document.getElementById("stopFeedback"),
			subBox: document.getElementById("subBox"),
			subCopyBtn: document.getElementById("subCopyBtn"),
			subFeedback: document.getElementById("subFeedback"),
			themeBtn: document.getElementById("themeBtn"),
			allBtn: document.getElementById("allBtn"),
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

		// 同步 UUID 卡片（UUID / NAME 输入框 + 折叠态）、停止命令、查看订阅命令到界面
		syncUuidSection();
		els.stopBox.textContent = Core.STOP_CMD;
		els.subBox.textContent = Core.SUB_CMD;

		// 「复制命令」按钮默认态 = copy 图标 +「复制命令」。app.js 是运行时唯一真源，
		// 这里归一化一次，抹平 index.html 里为「无 JS 也能看懂」而内联的默认标记。
		setCopyState(els.copyBtn, false);
		setCopyState(els.stopCopyBtn, false);
		setCopyState(els.subCopyBtn, false);

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
		if (els.showLogSwitch) { els.showLogSwitch.addEventListener("click", toggleShowLog); }
		// 整个 SHOW_LOG 字段组可点：点标题文字 / 点开关 / 点注释 / 点组内空白都能切换
		// （小白友好，与其它输入框「点标签即聚焦」一致）。
		// ⚠️ click 绑在**外层 .switch-field** 上（不是 .switch-row）——标题现在独占第一行、位于
		//     .switch-row 之外，若仍绑在行上，点标题就没反应了（功能回退）。
		// ⚠️ 开关本体自带 click（切换一次）；事件冒泡到本组会再次触发 → 若不放行，点一次会让开关
		//     连切两次、看起来「没反应」。故按 target 精确放行：只有点非按钮区域才走这里。
		if (els.showLogField) {
			els.showLogField.addEventListener("click", function (e) {
				if (e.target === els.showLogSwitch) { return; }
				toggleShowLog();
			});
		}
		els.copyBtn.addEventListener("click", doCopy);
		els.stopCopyBtn.addEventListener("click", doStopCopy);
		els.subCopyBtn.addEventListener("click", doSubCopy);
		// 工具栏三颗按钮：把反馈动效放在**事件处理的最前面**（而不是各函数内部的成功分支末尾）——
		// 这样无论后续逻辑走哪条分支，用户点了就一定有反馈：
		//   · #allBtn 的 enableAllNodes 在「已经全选」时会提前 return（只弹 toast）；
		//   · #themeBtn 的 toggleTheme 会重建按钮里的 svg。
		// 反馈放在最前面，上面两种情况都照常播放。键盘 Enter / 空格触发 click 同样命中这里。
		els.themeBtn.addEventListener("click", function () {
			replayPulse(els.themeBtn, "is-pulse-theme");
			toggleTheme();
		});
		/* 彩蛋：每次载入随机决定先露哪一面（≈各 50%），**刻意不持久化**（不进 localStorage）。
		 * 与全选是**同一个 click 上的两个独立 listener**，不是二选一：点一下既全选又翻面。 */
		if (Math.random() < 0.5) els.allBtn.classList.add("is-egg");

		els.allBtn.addEventListener("click", toggleAllBtnEgg);

		els.allBtn.addEventListener("click", function () {
			replayPulse(els.allBtn, "is-pulse-all");
			enableAllNodes();
		});
		els.resetBtn.addEventListener("click", function () {
			replayPulse(els.resetBtn, "is-pulse-reset");
			resetAll();
		});
		// 单一委托监听：动画一结束就摘掉反馈类（只绑一次，不随点击叠加）。
		document.addEventListener("animationend", onAnimationEnd);

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
