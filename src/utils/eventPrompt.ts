import { LifeEventSeed } from "../data/lifeEvents";

function formatList(items: string[]): string {
  return items.map((item, index) => `  ${index + 1}. ${item}`).join("\n");
}

export function buildEventSeedPrompt(event: LifeEventSeed): string {
  if (!event.promptSeed) {
    return `\n\n【现实人生事件触发：${event.title}】\n结合当前角色属性或主线，你在前方流年岁月中触发了一个高概率现实事件：${event.conceptPrompt || ""}\n请把这个事件设计成当前节点的关键现实局面，并尽量将“是否接受、如何合作、如何取舍、如何承担后果”等重大分叉交给用户通过 A, B, C 选择决定，不要在正文里提前替用户做完选择。`;
  }

  return `\n\n【现实人生事件触发：${event.title}】\n本轮只使用以下剧情指令，不要把它当成固定文本：\n- 核心事件：${event.promptSeed.core}\n- 上下文适配要求：\n${formatList(event.promptSeed.contextGuidance)}\n- 禁止：\n${formatList(event.promptSeed.forbidden)}\n- 选项方向：\n${formatList(event.promptSeed.optionDirections)}\n请把这个事件设计成当前节点的关键现实局面，并尽量将“是否接受、如何取舍、如何承担后果”等重大分叉交给用户通过 A, B, C 选择决定，不要在正文里提前替用户做完选择。`;
}
