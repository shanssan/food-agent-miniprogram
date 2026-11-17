const { request, accessToken, enterAccess, exitAccess } = require("../../api");
const { flavors, textures, staples, priorityChoices, guidedSteps } = require("./guided");

Page({
  data: {
    signedIn: false, inviteBusy: false, inviteError: "",
    turns: [], draft: "", busy: "", searching: false, starters: true,
    options: [], question: null, guidedActions: [],
    dishes: [], terms: [], recommendationId: null, emptyTitle: "还没有推荐",
    emptyDetail: "发送一条用餐需求后，候选会显示在这里。",
  },

  onLoad() {
    if (accessToken()) {
      this.setData({ signedIn: true });
      this.newMeal();
    }
  },
  onUnload() { if (this.search) this.search.abort(); },

  async redeemInvite(event) {
    if (this.data.inviteBusy) return;
    const code = event.detail.value.code.trim();
    if (!code) {
      this.setData({ inviteError: "请输入演示码 DEMO。" });
      return;
    }
    this.setData({ inviteBusy: true, inviteError: "" });
    try {
      await enterAccess(code);
      this.setData({ signedIn: true });
      this.newMeal();
    } catch (error) {
      this.setData({ inviteError: error.message });
    } finally {
      this.setData({ inviteBusy: false });
    }
  },

  signOut() { exitAccess(); },

  newMeal() {
    if (this.data.busy) return;
    this.sessionId = `mini-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.finishQuestion = null;
    this.guidedRequest = null;
    this.setData({
      turns: [], lastTurn: "", draft: "", starters: true,
      options: [], question: null, guidedActions: [],
    });
    this.clearResults();
  },

  openProfile() { wx.navigateTo({ url: "/pages/profile/profile" }); },
  inputDraft(event) { this.setData({ draft: event.detail.value }); },
  sendDraft() { return this.recommend(this.data.draft); },
  sendOption(event) { return this.recommend(this.data.options[event.currentTarget.dataset.index].message); },
  jumpToResults() { wx.pageScrollTo({ selector: "#results", duration: 220 }); },

  addTurn(text, sender = "agent", error = false) {
    if (!text) return;
    const id = `turn-${this.data.turns.length}`;
    this.setData({ ["turns[" + this.data.turns.length + "]"]: { id, text, sender, error }, lastTurn: id });
  },

  showReply(result) {
    const location = result.search_location && `本餐地点为${result.search_location}。`;
    const lines = [...new Set([result.feedback_message, result.memory_message, location, result.message].filter(Boolean))];
    this.addTurn(lines.join("\n"), "agent", ["parse_failed", "query_failed"].includes(result.status));
    this.setData({ options: result.options || [] });
  },

  clearResults(title = "还没有推荐", detail = "发送一条用餐需求后，候选会显示在这里。") {
    this.setData({ dishes: [], terms: [], recommendationId: null, emptyTitle: title, emptyDetail: detail });
  },

  showResults(result) {
    const dishes = (result.recommendations || []).map((item) => ({
      ...item,
      actions: [
        { label: "喜欢", value: "like" },
        { label: "已点这道菜", value: "order_confirmed" },
        ...(item.price_fen == null ? [] : [{ label: "太贵", value: "dislike", reason: "too_expensive" }]),
        { label: "口味不合", value: "dislike", reason: "taste" },
        { label: "以后别推荐这家", value: "exclude_merchant" },
      ],
      price: item.price_fen == null ? "标价未知" : `¥${(item.price_fen / 100).toFixed(2)}`,
      context: [item.merchant, item.cuisine, "样例菜单"].filter(Boolean).join(" · "),
    }));
    const terms = (result.search_terms || []).slice(0, Math.max(0, 5 - dishes.length)).map((term) => ({
      ...term,
      origin: [term.category, { catalog: "已保存菜品", demo: "模拟补充候选" }[result.source] || "外卖搜索词"].filter(Boolean).join(" · "),
      sourceUrl: /^https?:\/\//i.test(term.source_url || "") ? term.source_url : "",
      selectable: Boolean(result.source),
    }));
    if (!dishes.length && !terms.length) {
      const noMatch = result.status === "no_match";
      this.clearResults(noMatch ? "没有匹配的候选" : "等待本餐推荐",
        noMatch && result.source ? "可以调整这顿的条件，再试一次。" :
          noMatch ? "可以调整预算、位置或口味，再试一次。" : "你可以在对话里补充需求。");
      return;
    }
    this.setData({ dishes, terms, recommendationId: result.recommendation_id || null });
  },

  clearGuided() {
    this.finishQuestion = null;
    this.setData({ question: null, guidedActions: [] });
  },

  async recommend(text) {
    text = text.trim();
    if (!text || this.data.busy) return;
    this.clearGuided();
    this.setData({ starters: false, draft: "", options: [], busy: "正在查找候选…" });
    this.addTurn(text, "user");
    try {
      const result = await request("/recommend", "POST", { session_id: this.sessionId, message: text }).result;
      this.showReply(result);
      if (result.status !== "parse_failed") this.showResults(result);
      else if (!this.data.draft) this.setData({ draft: text });
    } catch (error) {
      if (!this.data.draft) this.setData({ draft: text });
      this.addTurn(error.message, "agent", true);
    } finally {
      this.setData({ busy: "" });
    }
  },

  feedback(event) {
    return this.recordFeedback(event.currentTarget.dataset.index, {
      value: "selected", label: "选择这项",
    });
  },

  openFeedback(event) {
    const { index } = event.currentTarget.dataset;
    const { busy, recommendationId, dishes } = this.data;
    const dish = dishes[index];
    if (busy || !recommendationId || !dish) return;
    wx.showActionSheet({
      itemList: dish.actions.map((action) => action.label),
      success: ({ tapIndex }) => {
        if (this.data.recommendationId === recommendationId && this.data.dishes[index]?.candidate_id === dish.candidate_id) {
          return this.recordFeedback(index, dish.actions[tapIndex]);
        }
      },
    });
  },

  async recordFeedback(index, { value: action, reason, label }) {
    const { busy, recommendationId, dishes } = this.data;
    if (busy || !recommendationId || !dishes[index]) return;
    const dish = dishes[index];
    this.setData({ busy: "正在处理反馈…" });
    try {
      const result = await request("/feedback", "POST", {
        session_id: this.sessionId, recommendation_id: recommendationId,
        candidate_id: dish.candidate_id, action, ...(reason ? { reason } : {}),
      }).result;
      this.addTurn(`${label} · ${dish.name}`, "user");
      this.showReply(result);
      if (!["feedback_recorded", "needs_clarification"].includes(result.status)) this.showResults(result);
      if (result.status === "feedback_recorded") wx.showToast({ title: "已记录反馈", icon: "none" });
      if (result.status === "needs_clarification") wx.pageScrollTo({ selector: ".conversation", duration: 220 });
    } catch (error) {
      if (error.status === 409) {
        this.setData({ recommendationId: null });
        this.addTurn("这轮推荐已无法接收反馈，请重新发送用餐需求。", "agent", true);
      } else this.addTurn(error.message, "agent", true);
      wx.pageScrollTo({ selector: ".conversation", duration: 220 });
    } finally {
      this.setData({ busy: "" });
    }
  },

  ask(text, labels, next, { multi = false, free = false, skip = false } = {}) {
    this.guidedQuestionCount++;
    this.addTurn(text);
    this.finishQuestion = next;
    this.setData({ guidedActions: [], question: {
      text, choices: labels.map((label) => ({ label, selected: false })), multi, free, skip, input: "", error: "",
    } });
  },

  answerChoice(event) {
    const question = this.data.question;
    if (!question || this.data.busy) return;
    const index = event.currentTarget.dataset.index;
    const choice = question.choices[index];
    if (!question.multi) return this.answer([choice.label]);
    this.setData({ [`question.choices[${index}].selected`]: !choice.selected, "question.error": "" });
  },

  inputAnswer(event) { this.setData({ "question.input": event.detail.value, "question.error": "" }); },
  skipAnswer() { return this.answer([]); },
  continueAnswer() {
    const question = this.data.question;
    if (!question || this.data.busy) return;
    const values = question.free
      ? question.input.split(/[、，,]/).map((value) => value.trim()).filter(Boolean)
      : question.choices.filter((choice) => choice.selected).map((choice) => choice.label);
    if (!values.length || values.length > 20 || values.some((value) => value.length > 40)) {
      this.setData({ "question.error": question.free ? "请输入 1 到 20 项，每项最多 40 字。" : "请选择一项或点击跳过。" });
      return;
    }
    return this.answer(values);
  },

  answer(values) {
    if (this.data.busy || !this.finishQuestion) return;
    const next = this.finishQuestion;
    this.clearGuided();
    this.addTurn(values.join("、") || "跳过", "user");
    return next(values);
  },

  startGuidedMeal() {
    if (this.data.busy) return;
    this.guidedQuestionCount = 0;
    this.setData({ starters: false, options: [] });
    this.clearResults();
    const criteria = { tastes: [], features: [], rejected_names: [] };
    this.ask("已经想到具体菜名了吗？", ["有一道想吃的", "按口味挑", "直接看候选"], ([mode]) => {
      const finish = () => this.ask("这顿有哪些食材需要避开？", [], (values) => {
        criteria.excluded_ingredients = values;
        return this.chooseGuidedPriority(criteria);
      }, { free: true, skip: true });
      if (mode === "有一道想吃的") {
        this.ask("想吃哪道菜？", [], ([name]) => { criteria.dish_name = name; finish(); }, { free: true });
      } else if (mode === "按口味挑") {
        const steps = guidedSteps(criteria);
        const advance = (values) => {
          const { done, value } = steps.next(values);
          if (done) finish();
          else this.ask(value[0], value[1], advance, value[2]);
        };
        advance();
      } else finish();
    });
  },

  chooseGuidedPriority(criteria, resultId) {
    const choices = priorityChoices(criteria);
    if (choices.length < 2) return this.findGuidedDishes(criteria);
    this.ask("这顿你最在意哪一项？", [...choices, "都一样重要"], ([choice]) => {
      if (resultId) this.recordGuidedFeedback(resultId, "clarified");
      return this.findGuidedDishes({ ...criteria, priority: choice || null });
    }, { skip: !resultId });
  },

  recordGuidedFeedback(resultId, action, dishName) {
    if (resultId) request("/guided-meal/feedback", "POST", {
      result_id: resultId, action, dish_name: dishName,
    }).result.catch(() => {});
  },

  async findGuidedDishes(criteria, online = false) {
    this.clearGuided();
    if (criteria.priority && criteria.priority !== "都一样重要" && !priorityChoices(criteria).includes(criteria.priority)) {
      criteria = { ...criteria, priority: null };
    }
    this.guidedRequest = criteria;
    this.guidedOnline = online;
    this.setData({ busy: online ? "正在读取模拟候选…" : "正在筛选已保存菜品…", searching: true });
    try {
      this.search = request("/guided-meal", "POST", {
        ...criteria, session_id: this.sessionId, local_only: !online, question_count: this.guidedQuestionCount,
      });
      const result = await this.search.result;
      this.guidedResultId = result.result_id;
      this.showReply(result);
      this.showResults({ ...result, status: ["none", "web_needed"].includes(result.source) ? "no_match" : "ok" });
      const actions = ["调整条件"];
      if (result.search_terms.length) {
        actions.push("都不想吃");
        if (!criteria.dish_name) actions.unshift("换一组");
      }
      if (result.clarify_priority) actions.unshift("选这顿最在意的");
      if (result.source === "web_needed") actions.push("查看模拟补充候选");
      if (result.source === "unavailable") actions.push("重新搜索");
      this.setData({ guidedActions: actions });
    } catch (error) {
      const stopped = error.name === "AbortError";
      this.addTurn(stopped ? "已停止等待。可以调整条件或重新搜索。" : error.message, "agent", !stopped);
      this.setData({ guidedActions: ["调整条件", "重新搜索"] });
    } finally {
      this.search = null;
      this.setData({ busy: "", searching: false });
    }
  },

  stopSearch() { if (this.search) this.search.abort(); },

  useGuidedAction(event) {
    if (this.data.busy || !this.guidedRequest) return;
    const label = event.currentTarget.dataset.label;
    const criteria = this.guidedRequest;
    if (label === "查看模拟补充候选") return this.findGuidedDishes(criteria, true);
    if (label === "选这顿最在意的") return this.chooseGuidedPriority(criteria, this.guidedResultId);
    if (label === "都不想吃") {
      this.recordGuidedFeedback(this.guidedResultId, "none");
      this.setData({ terms: this.data.terms.map((term) => ({ ...term, selectable: false })) });
      return this.adjustGuidedMeal(criteria);
    }
    if (label === "调整条件") {
      this.adjustGuidedMeal(criteria);
      wx.nextTick(() => wx.pageScrollTo({ selector: ".question", duration: 220 }));
      return;
    }
    if (label === "换一组") {
      const names = [...new Set([...criteria.rejected_names, ...this.data.terms.map((term) => term.name)])];
      return names.length <= 20
        ? this.findGuidedDishes({ ...criteria, rejected_names: names }, this.guidedOnline)
        : this.adjustGuidedMeal(criteria);
    }
    return this.findGuidedDishes(criteria, this.guidedOnline);
  },

  adjustGuidedMeal(criteria) {
    const inputs = {
      "味道": ["tastes", flavors], "口感": ["features", textures],
      "想吃的食材": ["ingredients", []], "避开的食材": ["excluded_ingredients", []],
    };
    const options = [...Object.keys(inputs)];
    if (criteria.required_staple) options.push("放宽主食要求");
    if (criteria.with_broth) options.push("也接受不带汤");
    if (criteria.dish_name) options.push("换个菜名");
    this.ask("想调整哪一项？", [...options, "重新选方向"], ([axis]) => {
      if (axis === "重新选方向") return this.startGuidedMeal();
      if (axis === "放宽主食要求") {
        return this.findGuidedDishes({
          ...criteria, required_staple: null,
          features: [...new Set([...criteria.features.filter((item) => !staples.includes(item)), criteria.required_staple])],
        });
      }
      if (axis === "也接受不带汤") return this.findGuidedDishes({ ...criteria, with_broth: false });
      if (axis === "换个菜名") {
        return this.ask("想吃哪道菜？", [], ([name]) =>
          this.findGuidedDishes({ ...criteria, dish_name: name }), { free: true, skip: true });
      }
      const [key, choices] = inputs[axis];
      this.ask(axis, choices, (values) => {
        const retained = key === "features" ? criteria.features.filter((value) => !textures.includes(value)) : [];
        return this.findGuidedDishes({ ...criteria, [key]: [...retained, ...values] });
      }, { multi: Boolean(choices.length), free: !choices.length, skip: true });
    });
  },

  chooseTerm(event) {
    const index = event.currentTarget.dataset.index;
    const term = this.data.terms[index];
    if (this.data.busy || !term || !term.selectable) return;
    this.recordGuidedFeedback(this.guidedResultId, "selected", term.name);
    this.clearGuided();
    this.setData({ terms: this.data.terms.map((item, i) => ({ ...item, selectable: false, chosen: i === index })) });
    this.addTurn(`这顿选了「${term.name}」。`, "user");
  },

  copySource(event) {
    const term = this.data.terms[event.currentTarget.dataset.index];
    if (term && term.sourceUrl) wx.setClipboardData({ data: term.sourceUrl });
  },
});
