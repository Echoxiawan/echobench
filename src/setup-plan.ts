import type { DoctorReport } from './types';

/**
 * 启动时自动安装的候选：
 * - 必需项全部可安装时才自动执行；
 * - 驱动属于项目内依赖，任何系统都可以自动补齐；
 * - adb/scrcpy/JDK 只在有 brew / winget 时自动安装，Linux 手动包管理器不静默提权。
 */
export function autoInstallCandidates(report: DoctorReport): string[] | null {
  const missingRequired = report.checks.filter((check) => check.required && check.status !== 'ok');
  if (missingRequired.length === 0) return [];
  if (missingRequired.some((check) => !check.installable)) return null;
  const canAutoSystem = report.system.packageManager === 'brew' || report.system.packageManager === 'winget';
  const ids = new Set<string>();
  for (const check of missingRequired) {
    if (check.id.startsWith('driver-') || canAutoSystem) ids.add(check.id);
  }
  for (const check of report.checks) {
    if (check.id === 'driver-xcuitest' && check.status !== 'ok' && check.installable) ids.add(check.id);
  }
  return ids.size > 0 ? [...ids] : null;
}
