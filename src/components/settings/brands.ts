// Official brand marks (MIT, @lobehub/icons-static-svg); bundled as local
// assets, so showing them never contacts the vendors.
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import doubao from "@lobehub/icons-static-svg/icons/doubao-color.svg";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import ollama from "@lobehub/icons-static-svg/icons/ollama.svg";
import openai from "@lobehub/icons-static-svg/icons/openai.svg";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import volcengine from "@lobehub/icons-static-svg/icons/volcengine-color.svg";

export const BRAND_LOGOS = {
  deepseek,
  doubao,
  gemini,
  ollama,
  openai,
  openrouter,
  qwen,
  volcengine,
} as const;

export type Brand = keyof typeof BRAND_LOGOS;
