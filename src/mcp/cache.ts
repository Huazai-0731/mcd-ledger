/**
 * 本地缓存：审计是"读多写零"的场景，重复跑同一个账号没必要重复打接口。
 * 默认只缓存"价格字典"（菜单，6 小时）与"活动日历"（2 小时）——
 * 订单与券永远实时拉取，因为它们是结论的主体。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export class Cache {
  private readonly dir: string;
  readonly enabled: boolean;

  constructor(dir: string, enabled: boolean) {
    this.dir = dir;
    this.enabled = enabled;
    if (enabled) mkdirSync(dir, { recursive: true });
  }

  get<T>(key: string, ttlMs: number): T | null {
    if (!this.enabled || ttlMs <= 0) return null;
    const file = this.pathOf(key);
    if (!existsSync(file)) return null;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { at: number; value: T };
      if (Date.now() - raw.at > ttlMs) return null;
      return raw.value;
    } catch {
      return null;
    }
  }

  set(key: string, value: unknown): void {
    if (!this.enabled) return;
    try {
      writeFileSync(this.pathOf(key), JSON.stringify({ at: Date.now(), value }), "utf8");
    } catch {
      /* 缓存失败不影响主流程 */
    }
  }

  private pathOf(key: string): string {
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
    return join(this.dir, `${hash}.json`);
  }
}
