import fs from "node:fs";
import path from "node:path";

const CONVENTIONAL_SUBJECT =
  /^(?:feat|fix|perf|refactor|docs|test|build|ci|chore|style|revert|deps)(?:\([a-z0-9][a-z0-9-]*\))?!?: (?=.*\p{Script=Han}).+$/u;
const AUTOMATED_SUBJECTS = [
  /^chore\(release\): \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
  /^Merge /u,
  /^Revert ".*\p{Script=Han}.*"$/u,
  /^(?:fixup|squash)! .*\p{Script=Han}/u,
];

export function commitMessageError(message: string): string | null {
  const subject = message.split(/\r?\n/u, 1)[0].trim();
  if (!subject) {
    return "提交标题不能为空。";
  }
  if (subject.length > 72) {
    return `提交标题不能超过 72 个字符，当前为 ${subject.length} 个字符。`;
  }
  if (
    !AUTOMATED_SUBJECTS.some((pattern) => pattern.test(subject)) &&
    !CONVENTIONAL_SUBJECT.test(subject)
  ) {
    return "提交标题必须使用 Conventional Commits，且摘要必须包含中文，例如：fix(release): 修复发布资产命名";
  }
  return null;
}

const currentFile = import.meta.filename;
const [, scriptFile, messageFile] = process.argv;
if (scriptFile && path.resolve(scriptFile) === currentFile) {
  if (messageFile) {
    const error = commitMessageError(fs.readFileSync(messageFile, "utf-8"));
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  } else {
    console.error("缺少 Git 提交信息文件路径。");
    process.exitCode = 1;
  }
}
