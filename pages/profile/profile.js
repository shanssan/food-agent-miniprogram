const { request } = require("../../api");

const fields = [
  { key: "home_region", label: "家乡" },
  { key: "usual_location", label: "常用用餐地点" },
  { key: "cuisines", label: "喜欢的菜系", multiple: true },
  { key: "tastes", label: "喜欢的口味", multiple: true },
  { key: "excluded_ingredients", label: "忌口", multiple: true },
];

Page({
  data: { fields, values: {}, roles: [], shops: [], ready: false, busy: false, error: "", notice: "" },

  onLoad() { return this.loadProfile(); },

  renderProfile(profile, notice = "") {
    this.profile = profile;
    const values = {};
    for (const { key, multiple } of fields) {
      values[key] = multiple ? profile[key].join("、") : profile[key] || "";
    }
    this.setData({ values, roles: profile.life_roles, shops: profile.excluded_merchants, ready: true, notice });
  },

  async loadProfile() {
    if (this.data.busy) return;
    this.setData({ ready: false, busy: true, error: "", notice: "正在读取画像…" });
    try {
      this.renderProfile(await request("/profile").result);
    } catch (error) {
      this.setData({ error: error.message, notice: "" });
    } finally {
      this.setData({ busy: false });
    }
  },

  updateField(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`values.${key}`]: event.detail.value });
  },

  updateRoles(event) { this.setData({ roles: event.detail.value }); },

  async saveProfile() {
    if (this.data.busy || !this.profile) return;
    const changes = {};
    for (const { key, multiple } of fields) {
      const text = this.data.values[key].trim();
      const value = multiple ? [...new Set(text.split(/[、,，]/).map((item) => item.trim()).filter(Boolean))] : text || null;
      if (JSON.stringify(value) !== JSON.stringify(this.profile[key])) changes[key] = value;
    }
    const { roles } = this.data;
    if (roles.length !== this.profile.life_roles.length || roles.some((role) => !this.profile.life_roles.includes(role))) {
      changes.life_roles = roles;
    }
    if (!Object.keys(changes).length) {
      this.setData({ error: "", notice: "画像没有改动。" });
      return;
    }
    this.setData({ busy: true, error: "", notice: "正在保存…" });
    try {
      this.renderProfile(await request("/profile", "POST", changes).result, "画像已保存。");
    } catch (error) {
      this.setData({ notice: "", error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },

  async restoreMerchant(event) {
    if (this.data.busy) return;
    const key = event.currentTarget.dataset.key;
    this.setData({ busy: true, error: "", notice: "" });
    try {
      await request(`/profile/excluded-merchants/${encodeURIComponent(key)}`, "DELETE").result;
      const shops = this.data.shops.filter((shop) => shop.merchant_key !== key);
      this.setData({ shops, notice: "已撤销屏蔽。" });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
});
