const accessKey = "food-agent-demo-access";
const profileKey = "food-agent-demo-profile";

const menu = [
  { candidate_id: "demo-1", name: "番茄鸡蛋面", merchant: "示例面馆", cuisine: "家常菜", price_fen: 1800, ingredients: ["番茄", "鸡蛋"], tastes: ["清淡", "不辣", "咸鲜"] },
  { candidate_id: "demo-2", name: "香菇滑鸡饭", merchant: "示例便当铺", cuisine: "粤式风味", price_fen: 2600, ingredients: ["香菇", "鸡肉"], tastes: ["咸鲜", "不辣"] },
  { candidate_id: "demo-3", name: "酸辣土豆丝盖饭", merchant: "示例小食堂", cuisine: "家常菜", price_fen: 2200, ingredients: ["土豆", "辣椒"], tastes: ["酸", "辣", "酸辣"] },
  { candidate_id: "demo-4", name: "小米南瓜粥", merchant: "示例粥铺", cuisine: "家常菜", price_fen: 1200, ingredients: ["小米", "南瓜"], tastes: ["清淡", "甜", "不辣"] },
  { candidate_id: "demo-5", name: "香菇青菜包", merchant: "示例包点店", cuisine: "家常菜", price_fen: 900, ingredients: ["香菇", "青菜"], tastes: ["清淡", "咸鲜", "不辣"] },
  { candidate_id: "demo-6", name: "酱香豆腐饭", merchant: "示例小食堂", cuisine: "家常菜", price_fen: 2000, ingredients: ["豆腐", "米饭"], tastes: ["酱香", "咸鲜", "不辣"] },
];

function getProfile() {
  return wx.getStorageSync(profileKey) || {
    home_region: "示例镇", usual_location: "示例社区", cuisines: ["家常菜"], tastes: ["清淡"],
    excluded_ingredients: [], life_roles: ["在职"],
    excluded_merchants: [{ merchant_key: "示例便当铺", name: "示例便当铺" }],
  };
}

function saveProfile(changes) {
  const profile = { ...getProfile(), ...changes };
  wx.setStorageSync(profileKey, profile);
  return profile;
}

function avoidsIngredients(dish, excluded) {
  return !excluded.some((item) => dish.name.includes(item) || dish.ingredients.some((ingredient) => ingredient.includes(item)));
}

function recommend(message) {
  const profile = getProfile();
  const budget = message.match(/(?:预算\s*)?(\d+(?:\.\d+)?)\s*(?:元|块)/);
  const tastes = message.includes("清淡") ? ["清淡"] : message.includes("不辣") ? ["不辣"] : [];
  const recommendations = menu.filter((dish) =>
    (!budget || dish.price_fen <= Number(budget[1]) * 100) &&
    (!tastes.length || dish.tastes.includes(tastes[0])) &&
    avoidsIngredients(dish, profile.excluded_ingredients) &&
    !profile.excluded_merchants.some((shop) => shop.merchant_key === dish.merchant)
  ).slice(0, 3);
  return {
    status: recommendations.length ? "ok" : "no_match",
    message: recommendations.length ? "这是按演示菜单生成的候选。" : "演示菜单里没有符合这些条件的菜。",
    recommendations,
    recommendation_id: "demo-recommendation",
  };
}

function guidedMeal(data) {
  const { dish_name, local_only, tastes = [], rejected_names = [], excluded_names = [],
    excluded_tastes = [], ingredients = [], excluded_ingredients = [] } = data;
  const matching = menu.filter((dish) =>
    (!dish_name || dish.name.includes(dish_name)) &&
    (!tastes.length || tastes.some((taste) => dish.tastes.includes(taste))) &&
    !excluded_tastes.some((taste) => dish.tastes.includes(taste)) &&
    !rejected_names.includes(dish.name) &&
    !excluded_names.some((name) => dish.name.includes(name)) &&
    ingredients.every((item) => dish.name.includes(item) || dish.ingredients.some((ingredient) => ingredient.includes(item))) &&
    avoidsIngredients(dish, excluded_ingredients)
  );
  const search_terms = matching.slice(0, 3).map(({ name, cuisine }) => ({ name, category: cuisine }));
  if (!local_only && !search_terms.length && dish_name &&
      !excluded_ingredients.length && !excluded_names.some((name) => dish_name.includes(name))) {
    search_terms.push({ name: dish_name, category: "虚构候选", reason: "根据输入生成的演示条目，无实际菜单来源。" });
  }
  return {
    result_id: "demo-guided",
    source: search_terms.length ? (local_only ? "catalog" : "demo") : (local_only ? "web_needed" : "none"),
    search_terms,
    message: search_terms.length ? "以下是模拟菜单候选。" : "模拟菜单暂无符合条件的候选。",
  };
}

function respond(path, method, data) {
  if (path === "/recommend") return recommend(data.message);
  if (path === "/guided-meal") return guidedMeal(data);
  if (path === "/guided-meal/feedback") return null;
  if (path === "/feedback") {
    if (data.action === "exclude_merchant") {
      const { merchant } = menu.find((dish) => dish.candidate_id === data.candidate_id);
      const { excluded_merchants } = getProfile();
      if (!excluded_merchants.some((shop) => shop.merchant_key === merchant)) {
        saveProfile({ excluded_merchants: [...excluded_merchants, { merchant_key: merchant, name: merchant }] });
      }
    }
    return { status: "feedback_recorded", message: "已演示反馈流程。" };
  }
  if (path === "/profile") return method === "POST" ? saveProfile(data) : getProfile();
  const prefix = "/profile/excluded-merchants/";
  if (method === "DELETE" && path.startsWith(prefix)) {
    const key = decodeURIComponent(path.slice(prefix.length));
    saveProfile({ excluded_merchants: getProfile().excluded_merchants.filter((shop) => shop.merchant_key !== key) });
    return null;
  }
  throw new Error("该操作没有离线演示数据。");
}

function request(path, method = "GET", data) {
  let timer;
  let rejectResult;
  const result = new Promise((resolve, reject) => {
    rejectResult = reject;
    timer = setTimeout(() => {
      try { resolve(respond(path, method, data)); }
      catch (error) { reject(error); }
    }, path === "/guided-meal" ? 500 : 0);
  });
  return {
    result,
    abort() {
      clearTimeout(timer);
      const error = new Error("已停止等待。");
      error.name = "AbortError";
      rejectResult(error);
    },
  };
}

function accessToken() { return wx.getStorageSync(accessKey); }

async function enterAccess(code) {
  if (code.toUpperCase() !== "DEMO") throw new Error("请输入演示码 DEMO。");
  wx.setStorageSync(accessKey, true);
}

function exitAccess() {
  wx.removeStorageSync(accessKey);
  wx.reLaunch({ url: "/pages/meal/meal" });
}

module.exports = { request, accessToken, enterAccess, exitAccess };
