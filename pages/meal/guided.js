const flavors = ["咸鲜", "酸", "辣", "酸辣", "甜", "酱香", "清淡", "不辣"];
const textures = ["酥脆", "软糯", "嫩滑", "有嚼劲", "清脆"];
const staples = ["米饭", "面条／粉", "饼／包点", "杂粮／薯类"];

function priorityChoices(criteria) {
  return [
    criteria.tastes?.length && "口味", criteria.ingredients?.length && "食材",
    criteria.features.some((feature) => textures.includes(feature)) && "口感",
    !criteria.required_staple && criteria.features.some((feature) => staples.includes(feature)) && "主食",
    criteria.features.includes("热乎") && "温度", criteria.filling && "饱腹感",
    (criteria.familiar || criteria.novelty === "熟悉菜稍作变化") && "熟悉度",
  ].filter(Boolean);
}

// 每次 yield 提供题目、选项和交互方式，页面用 next(answers) 送回答案。
// 根据用户选的目标继续提问，把答案写进同一个筛选对象，最后交给找菜接口。
function* guidedSteps(request) {
  const goals = yield ["这顿最想满足什么？", ["填饱肚子", "满足馋劲", "吃得舒服", "换换口味"], { multi: true, skip: true }];
  for (const goal of goals) {
    if (goal === "填饱肚子") {
      request.filling = true;
      const [portion] = yield ["这顿想吃多少？", ["小份", "正常份", "大份"], { skip: true }];
      request.portion = portion;
      const [staple] = yield ["想吃什么主食？", staples, { skip: true }];
      if (staple) {
        const [requirement] = yield [`这顿一定要选${staple}吗？`, ["必须是", "优先考虑"]];
        if (requirement === "必须是") request.required_staple = staple;
        else request.features.push(staple);
      }
    } else if (goal === "满足馋劲") {
      const directions = yield ["最明确的是哪方面？", ["味道", "口感", "食材"], { multi: true, skip: true }];
      if (directions.includes("味道")) request.tastes.push(...(yield ["哪些味道你都能接受？", flavors, { multi: true, skip: true }]));
      if (directions.includes("口感")) request.features.push(...(yield ["想要哪些口感？", textures, { multi: true, skip: true }]));
      if (directions.includes("食材")) request.ingredients = yield ["想吃什么食材？", [], { free: true, skip: true }];
    } else if (goal === "吃得舒服") {
      const choices = yield ["怎样吃会觉得舒服？", ["热乎", "清爽少油", "软糯", "带汤", "熟悉合口"], { multi: true, skip: true }];
      if (choices.includes("清爽少油") && !request.tastes.includes("清淡")) request.tastes.push("清淡");
      request.features.push(...choices.filter((label) => ["软糯", "热乎"].includes(label)));
      request.with_broth = choices.includes("带汤");
      request.familiar = choices.includes("熟悉合口");
      if (request.familiar) request.familiar_names = yield ["有哪些平时爱吃的家常菜？", [], { free: true, skip: true }];
    } else if (goal === "换换口味") {
      request.excluded_names = yield ["想避开哪道最近吃过的菜？", [], { free: true, skip: true }];
      request.excluded_tastes = yield ["这顿想避开什么口味？", flavors, { multi: true, skip: true }];
      const [novelty] = yield ["想换到什么程度？", ["熟悉菜稍作变化", "熟悉食材换做法", "尝试没吃过的"], { skip: true }];
      request.novelty = novelty;
    }
  }
}

module.exports = { flavors, textures, staples, priorityChoices, guidedSteps };
