// vibeweaver-dsh Arm-A 基线插件 — 全量 SKILL.md 静态注入（bench 对照用）
// 语义: 每轮系统提示词常驻完整 SKILL.md 正文（"强制注入"的最强形态）
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

export const name = "vibeweaver-baseline"
export const inject = ["systemPrompt"]

export function apply(ctx, config = {}) {
  const skillSourceDir = config.skillSourceDir || process.env.VIBEWEAVER_SKILL_DIR || join(homedir(), ".config/opencode/skills/vibeweaver")
  const path = join(skillSourceDir, "SKILL.md")

  ctx.systemPrompt.section({
    name: "vibeweaver-full",
    order: 100,
    text: () => {
      if (!existsSync(path)) {
        return "# vibeweaver（全文不可用：SKILL.md 未找到）\n" +
          `请检查 skillSourceDir: ${skillSourceDir}\n`
      }
      return readFileSync(path, "utf8")
    },
  })
}
