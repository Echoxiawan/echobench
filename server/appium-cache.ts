import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** Appium 会把驱动的绝对 installPath 写入缓存；项目目录改名或移动后需要改回当前路径。 */
export function repairAppiumDriverPaths(manifest: string, projectRoot: string): { text: string; changed: boolean } {
  let changed = false;
  const text = manifest.replace(/^(\s*installPath:\s*)(.+)$/gm, (line, prefix: string, rawPath: string) => {
    const current = rawPath.trim();
    const name = basename(current);
    if (!/^appium-(xcuitest|uiautomator2)-driver$/.test(name)) return line;
    const expected = join(projectRoot, 'node_modules', name);
    if (current === expected) return line;
    changed = true;
    return `${prefix}${expected}`;
  });
  return { text, changed };
}

export async function repairAppiumCache(projectRoot = process.cwd()): Promise<boolean> {
  const cachePath = join(projectRoot, 'node_modules', '.cache', 'appium', 'extensions.yaml');
  try {
    const raw = await readFile(cachePath, 'utf8');
    const repaired = repairAppiumDriverPaths(raw, projectRoot);
    if (!repaired.changed) return false;
    await writeFile(cachePath, repaired.text, 'utf8');
    return true;
  } catch { return false; }
}
