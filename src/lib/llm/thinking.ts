/**
 * 思考档位 → 请求参数的映射（协议层，服务端 provider 与前端设置共用）。
 *
 * 档位抽象定义见 src/lib/settings.ts 的 ReasoningEffort：
 * - "auto"：不传任何 thinking 参数，交给模型决定
 * - "off"：传 enable_thinking=false（DeepSeek 风格端点的软开关）
 * - "low" / "high" / "max"：作为 reasoning_effort 原样透传
 *
 * 这里刻意不做「按模型能力 clamp / 路由」的映射表：端点不支持就直接把
 * 400 暴露给用户，比静默降级到别的档位好。
 *
 * 参数类型放宽为 string：服务端拿到的值来自请求体，任何客户端都可能传
 * 未知档位，未知值原样透传，由端点决定接受还是报错。
 */

export type ThinkingPayload = { enable_thinking: boolean };

/**
 * 返回 undefined = 不传参数；字符串 = reasoning_effort 的值；对象 = 开关式载荷。
 */
export function resolveThinkingParam(
  effort: string | undefined,
): string | ThinkingPayload | undefined {
  if (!effort || effort === "auto") return undefined;
  if (effort === "off") return { enable_thinking: false };
  return effort;
}
