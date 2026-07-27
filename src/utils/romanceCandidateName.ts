const GENERIC_ROMANCE_REFERENCES = /^(?:你|我|他|她|它|对方|对象|伴侣|恋人|男友|女友|男朋友|女朋友|朋友|同事|同学|校友|客户|合作方|合伙人|投资人|创业者|导师|老师|教练|瑜伽教练|摄影师|编辑|医生|护士|一位.+|一个.+|那位.+|这位.+|另一位.+)$/u;
const ROLE_DESCRIPTION_SUFFIX = /(?:男生|女生|男人|女人|同事|同学|校友|客户|合作方|合伙人|投资人|创业者|导师|老师|教练|摄影师|编辑|医生|护士|程序员|产品经理|负责人)$/u;
const STABLE_CHINESE_APPELLATION = /^(?:老|小|阿)[\p{Script=Han}]{1,2}$/u;

export function isValidRomanceDisplayName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = value.trim();
  if (!name || name.length > 24) return false;
  if (GENERIC_ROMANCE_REFERENCES.test(name)) return false;
  if (STABLE_CHINESE_APPELLATION.test(name)) return true;
  return !ROLE_DESCRIPTION_SUFFIX.test(name);
}
