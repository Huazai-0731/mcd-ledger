/**
 * 轨迹记录器：把每一次 MCP 工具调用写成 jsonl，供 viewer/trace-viewer.html 回放。
 *
 * 这是"可复现"的物理基础：用户贴一份 trace.jsonl，就能说明这次审计到底调了什么、
 * 每一步耗时多少、哪一步降级了。没有 trace 的 Agent 项目，出问题只能靠嘴解释。
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TraceCall } from "../model/types.ts";

export interface TraceMeta {
  version: string;
  command: string;
  startedAt: string;
  mode: "live" | "demo";
}

export class TraceRecorder {
  readonly id: string;
  readonly file: string;
  private readonly meta: TraceMeta;
  private calls: TraceCall[] = [];
  private seq = 0;
  private startedMs = Date.now();

  constructor(dir: string, command: string, mode: "live" | "demo") {
    this.id = `trace-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    this.file = join(dir, `${this.id}.jsonl`);
    this.meta = {
      version: "0.1.0",
      command,
      startedAt: new Date().toISOString(),
      mode,
    };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(
      this.file,
      JSON.stringify({ type: "meta", ...this.meta }) + "\n",
      "utf8",
    );
  }

  /** 开始一次调用计时，返回一个收尾函数 */
  begin(tool: string, attempt = 1): (res: {
    ok: boolean;
    bytes?: number;
    error?: string;
  }) => TraceCall {
    const id = ++this.seq;
    const t0 = Date.now();
    return (res) => {
      const call: TraceCall = {
        id,
        tool,
        startedAt: new Date(t0).toISOString(),
        durationMs: Date.now() - t0,
        ok: res.ok,
        attempt,
        bytes: res.bytes ?? 0,
      };
      if (res.error) call.error = res.error;
      this.calls.push(call);
      appendFileSync(this.file, JSON.stringify({ type: "call", ...call }) + "\n", "utf8");
      return call;
    };
  }

  /** 记录一次降级判定，便于事后复盘 */
  note(event: string, detail: string): void {
    appendFileSync(
      this.file,
      JSON.stringify({
        type: "note",
        at: new Date().toISOString(),
        event,
        detail,
      }) + "\n",
      "utf8",
    );
  }

  get all(): TraceCall[] {
    return this.calls;
  }

  get toolCalls(): number {
    return this.calls.length;
  }

  get durationMs(): number {
    return Date.now() - this.startedMs;
  }

  /** 工具调用分布，报告里用来说明"9 次调用才出一张账本" */
  summary(): Array<{ tool: string; calls: number; totalMs: number; failures: number }> {
    const map = new Map<string, { calls: number; totalMs: number; failures: number }>();
    for (const c of this.calls) {
      const cur = map.get(c.tool) ?? { calls: 0, totalMs: 0, failures: 0 };
      cur.calls += 1;
      cur.totalMs += c.durationMs;
      if (!c.ok) cur.failures += 1;
      map.set(c.tool, cur);
    }
    return [...map.entries()]
      .map(([tool, v]) => ({ tool, ...v }))
      .sort((a, b) => b.calls - a.calls);
  }
}
