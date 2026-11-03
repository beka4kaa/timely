import { createLucideIcon } from "lucide-react";

/**
 * «Сейчас»: узел на ленте дня и строки справа от него.
 *
 * В наборе lucide такого знака нет, а ближайшие (часы, домик, список) говорят
 * не то: раздел — не время и не «главная», а место на ленте дня.
 */
export const NowIcon = createLucideIcon("Now", [
  ["path", { d: "M6 3v5", key: "top" }],
  ["path", { d: "M6 16v5", key: "bottom" }],
  ["circle", { cx: "6", cy: "12", r: "2.6", key: "node" }],
  ["path", { d: "M11.5 12H21", key: "line" }],
  ["path", { d: "M11.5 6.5H17", key: "above" }],
  ["path", { d: "M11.5 17.5H17", key: "below" }],
]);
