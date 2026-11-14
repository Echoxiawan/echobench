import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const target = join(root, 'resources', 'jre');
const javaHome = process.env.JAVA_HOME?.trim();
const executable = process.platform === 'win32' ? 'java.exe' : 'java';

if (!javaHome) {
  console.warn('[runtime] JAVA_HOME is not set; skipping JRE bundling.');
  process.exit(0);
}

try {
  await access(join(javaHome, 'bin', executable), constants.X_OK);
} catch {
  console.warn(`[runtime] ${javaHome} does not look like a Java home; skipping JRE bundling.`);
  process.exit(0);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(javaHome, target, { recursive: true, dereference: true });
await writeFile(join(target, '.gitkeep'), '');
console.log(`[runtime] bundled JRE from ${javaHome} -> ${target}`);
