/**
 * 极简测试运行器：不引入 vitest/jest —— 参赛项目里"多一个依赖"就多一道劝退。
 * 输出同时兼容人读与 CI 判断（退出码）。
 */
import { CASES } from "./cases.ts";

const GREEN = process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[32m" : "";
const RED = process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[31m" : "";
const DIM = process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[2m" : "";
const RESET = process.stdout.isTTY && !process.env.NO_COLOR ? "\x1b[0m" : "";

export async function runBench(): Promise<boolean> {
  process.stdout.write("\n  麦麦账本 · 归因算法回归用例\n\n");

  let passed = 0;
  const failures: Array<{ name: string; error: string }> = [];

  for (const testCase of CASES) {
    try {
      testCase.run();
      passed += 1;
      process.stdout.write(`  ${GREEN}✓${RESET} ${testCase.name}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ name: testCase.name, error: message });
      process.stdout.write(`  ${RED}✗${RESET} ${testCase.name}\n${DIM}      ${message}${RESET}\n`);
    }
  }

  const total = CASES.length;
  process.stdout.write(
    `\n  ${passed}/${total} 通过${failures.length > 0 ? `，${failures.length} 失败` : ""}\n\n`,
  );

  return failures.length === 0;
}

if (process.argv[1]?.endsWith("run.ts")) {
  runBench().then((ok) => {
    if (!ok) process.exitCode = 1;
  });
}
