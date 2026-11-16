import type { DoctorCheck, DoctorReport, Platform } from './types.js';

export interface ConnectionDiagnostic {
  title: string;
  summary: string;
  blockers: DoctorCheck[];
  suggestions: string[];
  details: string;
}

const COMMON_IDS = ['node', 'appium'];
const PLATFORM_IDS: Record<Platform, string[]> = {
  android: [...COMMON_IDS, 'driver-uiautomator2', 'adb', 'android-sdk', 'java'],
  ios: [...COMMON_IDS, 'driver-xcuitest', 'xcode', 'java'],
};

export function relevantConnectionChecks(report: DoctorReport | null | undefined, platform: Platform): DoctorCheck[] {
  if (!report) return [];
  const ids = new Set(PLATFORM_IDS[platform]);
  return report.checks.filter((check) => ids.has(check.id));
}

export function missingConnectionChecks(report: DoctorReport | null | undefined, platform: Platform): DoctorCheck[] {
  return relevantConnectionChecks(report, platform).filter((check) => check.status !== 'ok');
}

export function connectionEnvironmentError(report: DoctorReport, platform: Platform): string | null {
  const missing = missingConnectionChecks(report, platform);
  if (missing.length === 0) return null;
  const label = platform === 'android' ? 'Android' : 'iOS';
  return `缺少连接 ${label} 设备所需环境：${missing.map((check) => check.name).join('、')}。请打开“环境体检”或“安装帮助”处理后再重试。`;
}

export function buildConnectionDiagnostic(
  raw: string,
  report: DoctorReport | null,
  platform: Platform,
  t: (source: string, params?: Record<string, string | number>) => string = (source) => source,
): ConnectionDiagnostic {
  const label = platform === 'android' ? 'Android' : 'iOS';
  const blockers = missingConnectionChecks(report, platform);
  const suggestions = [...new Set(blockers.map((check) => check.fix).filter((fix): fix is string => Boolean(fix)))];
  const fallback = classifyConnectionError(raw, platform);

  return {
    title: t('无法连接 {platform} 设备', { platform: label }),
    summary: blockers.length > 0
      ? t('缺少必要环境：{checks}。', { checks: blockers.map((check) => t(check.name)).join(localeListSeparator(t)) })
      : t(fallback.summary),
    blockers,
    suggestions: [...new Set([...suggestions, ...fallback.suggestions].map((item) => t(item)))],
    details: raw.trim().slice(0, 6000),
  };
}

function localeListSeparator(t: (source: string) => string): string {
  return t('、') === '、' ? '、' : ', ';
}

function classifyConnectionError(raw: string, _platform: Platform): { summary: string; suggestions: string[] } {
  if (/unauthorized/i.test(raw)) {
    return {
      summary: '设备尚未授权 USB 调试，EchoBench 无法建立连接。',
      suggestions: ['解锁设备，在 USB 调试授权弹窗中点击“允许”，然后重新连接。'],
    };
  }
  if (/\boffline\b|device.*offline/i.test(raw)) {
    return {
      summary: '设备当前处于离线状态。',
      suggestions: ['重新插拔 USB，确认设备已解锁，并执行 adb devices 检查设备状态。'],
    };
  }
  if (/could not find a connected|device.*not found|no devices|no android devices/i.test(raw)) {
    return {
      summary: 'Appium 找不到指定设备，设备可能已断开或 UDID 不正确。',
      suggestions: ['点击“发现设备”重新扫描，确认 UDID 与 adb devices 输出一致，并重新插拔设备。'],
    };
  }
  if (/econnrefused|appium.*not running|connect.*4723|failed to connect to.*4723/i.test(raw)) {
    return {
      summary: 'Appium 服务未能启动或无法连接。',
      suggestions: ['打开日志确认 Appium 启动错误，检查 Java/JDK 和 Appium 驱动是否可用，然后重试。'],
    };
  }
  if (/android_home|android_sdk_root|android sdk|sdkmanager/i.test(raw)) {
    return {
      summary: 'Android SDK 未安装、路径无效或环境变量未配置。',
      suggestions: ['安装 Android SDK，并将 ANDROID_HOME/ANDROID_SDK_ROOT 指向 SDK 目录后重启 EchoBench。'],
    };
  }
  if (/requires a development team|xcodebuild failed with code 65/i.test(raw)) {
    return {
      summary: 'iOS WebDriverAgent 签名失败。',
      suggestions: ['填写 XCODE TEAM ID，并在 Xcode 中为 WebDriverAgentRunner 配置开发团队和 provisioning profile。'],
    };
  }
  if (/remotexpc tunnel|tunnel registry port not found/i.test(raw)) {
    return {
      summary: 'iOS 18+ 真机 RemoteXPC 隧道创建失败。',
      suggestions: ['使用 USB 连接设备，并按帮助文档运行 XCUITest tunnel-creation 后重试。'],
    };
  }
  if (/permission denied|insufficient permissions/i.test(raw)) {
    return {
      summary: '当前用户没有访问设备或工具链所需的权限。',
      suggestions: [
        'Linux 用户请配置 Android udev 规则并把当前用户加入 plugdev 组，重新登录后重试。',
        'Windows/macOS 用户请检查设备 USB 调试授权、Android SDK 目录权限和 Xcode 命令行工具权限。',
      ],
    };
  }
  return {
    summary: '设备连接失败，当前错误需要结合环境状态进一步排查。',
    suggestions: ['确认设备在线且已授权，检查必要环境，并打开运行日志查看 Appium/WDA 的完整错误。'],
  };
}
