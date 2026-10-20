/**
 * 服务探测核心 —— 纯逻辑：不查询 DOM、不绑定事件、不引用页面结构。
 *
 * 延迟取自浏览器 Resource Timing API：
 *   performance.getEntriesByType("resource") 中与本次请求 URL 匹配的条目，
 *   duration = responseEnd - startTime，即浏览器实测的真实网络耗时
 *   （排队 + DNS + 连接 + TLS + TTFB + 下载）。
 *
 * 跨域资源若服务端未返回 Timing-Allow-Origin，浏览器会把分阶段字段清零，
 * 此时只有 duration 可用（detailed = false，页面据此给出提示）。
 */

export type ProbeState = "up" | "slow" | "degraded" | "down";

export interface ServiceConfig {
  id: string;
  name: string;
  url: string;
  desc?: string;
  expectText?: string;
  slowMs?: number;
  timeout?: number;
  cacheBust?: boolean;
}

export interface TimingInfo {
  source: "resource-timing" | "clock";
  duration: number;
  dns: number;
  connect: number;
  tls: number;
  ttfb: number;
  download: number;
  transferSize: number;
  protocol: string;
  detailed: boolean;
}

export interface ProbeResult {
  serviceId: string;
  url: string;
  state: ProbeState;
  reason: string;
  httpStatus: number;
  opaque: boolean;
  bodyText: string;
  mode: string;
  latency: number;
  timing: TimingInfo;
  verified: boolean;
  at: number;
  errorType: string;
  errorMessage: string;
}

interface Verdict {
  state: ProbeState;
  reason: string;
  verified: boolean;
}

interface Attempt {
  ok: boolean;
  response: Response | null;
  errorType: string;
  errorMessage: string;
}

const DEFAULT_TIMEOUT = 8000;
const DEFAULT_SLOW_MS = 800;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

/** 拼出本次探测实际请求的 URL（默认加时间戳绕开缓存） */
export function buildProbeUrl(service: ServiceConfig): string {
  if (service.cacheBust === false) {
    return service.url;
  }
  const parsed = new URL(service.url);
  parsed.searchParams.set("_ts", String(Date.now()));
  return parsed.toString();
}

function stripQuery(url: string): string {
  const index = url.indexOf("?");
  return index < 0 ? url : url.slice(0, index);
}

function findResourceEntry(targetUrl: string): PerformanceResourceTiming | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
    return null;
  }
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const base = stripQuery(targetUrl);
  let found: PerformanceResourceTiming | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.name === targetUrl || stripQuery(entry.name) === base) {
      found = entry;
    }
  }
  return found;
}

function clockTiming(clockMs: number): TimingInfo {
  return {
    source: "clock",
    duration: round1(clockMs),
    dns: 0,
    connect: 0,
    tls: 0,
    ttfb: 0,
    download: 0,
    transferSize: 0,
    protocol: "",
    detailed: false
  };
}

/**
 * 从 Resource Timing 里读出本次请求的耗时明细。
 * 找不到条目时（例如被拦截、或环境不支持）退回 performance.now() 计时。
 */
export function readTiming(targetUrl: string, clockMs: number): TimingInfo {
  const entry = findResourceEntry(targetUrl);
  if (!entry) {
    return clockTiming(clockMs);
  }
  // 跨域且无 Timing-Allow-Origin 时 requestStart / responseStart 会被清零
  const detailed = entry.requestStart > 0 && entry.responseStart > 0;
  return {
    source: "resource-timing",
    duration: round1(entry.duration),
    dns: detailed ? round1(Math.max(0, entry.domainLookupEnd - entry.domainLookupStart)) : 0,
    connect: detailed ? round1(Math.max(0, entry.connectEnd - entry.connectStart)) : 0,
    tls:
      detailed && entry.secureConnectionStart > 0
        ? round1(Math.max(0, entry.connectEnd - entry.secureConnectionStart))
        : 0,
    ttfb: detailed ? round1(Math.max(0, entry.responseStart - entry.requestStart)) : 0,
    download: detailed ? round1(Math.max(0, entry.responseEnd - entry.responseStart)) : 0,
    transferSize: entry.transferSize > 0 ? entry.transferSize : 0,
    protocol: entry.nextHopProtocol ? entry.nextHopProtocol : "",
    detailed: detailed
  };
}

function classifyError(error: any): string {
  const name = error && error.name ? String(error.name) : "";
  const message = error && error.message ? String(error.message) : "";
  if (name === "AbortError") return "timeout";
  if (name === "NotAllowedError") return "blocked";
  if (message.indexOf("Failed to fetch") >= 0) return "network-or-cors";
  if (message.toLowerCase().indexOf("fetch failed") >= 0) return "network-or-cors";
  if (message.indexOf("NetworkError") >= 0) return "network";
  if (message.indexOf("CORS") >= 0) return "cors";
  return "unknown";
}

function describeError(error: any, timeout: number): string {
  const type = classifyError(error);
  if (type === "timeout") return "超时：" + timeout + " ms 内没有响应";
  if (type === "network-or-cors") return "无法连接：网络不可达，或被 CORS / 拦截插件阻止";
  if (type === "network") return "网络错误：DNS 解析失败或连接被拒绝";
  if (type === "cors") return "CORS 策略阻止";
  if (type === "blocked") return "请求被浏览器或扩展阻止";
  return error && error.message ? String(error.message) : "未知错误";
}

function delay(ms: number): Promise<void> {
  return new Promise<void>(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * 读取本次请求的 Resource Timing。
 * 资源只有「下载完成」之后才会写进 performance 条目，
 * 所以调用点必须放在响应体读完之后；万一浏览器入库稍晚，这里再等一小会儿重试。
 */
async function readTimingSettled(targetUrl: string, startedAt: number): Promise<TimingInfo> {
  for (let i = 0; i < 4; i++) {
    const timing = readTiming(targetUrl, now() - startedAt);
    if (timing.source === "resource-timing") {
      return timing;
    }
    await delay(40);
  }
  return readTiming(targetUrl, now() - startedAt);
}

async function attemptFetch(url: string, mode: RequestMode, timeout: number): Promise<Attempt> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(function () {
    timedOut = true;
    controller.abort();
  }, timeout);
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: mode,
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal
    });
    return { ok: true, response: response, errorType: "", errorMessage: "" };
  } catch (error) {
    const type = timedOut ? "timeout" : classifyError(error);
    return {
      ok: false,
      response: null,
      errorType: type,
      errorMessage: describeError(error, timeout)
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 依据状态码 / 响应内容 / 耗时给出结论，纯函数，方便单独推敲判定规则 */
export function judgeState(
  service: ServiceConfig,
  httpStatus: number,
  bodyText: string,
  opaque: boolean,
  latency: number
): Verdict {
  const slowMs = service.slowMs && service.slowMs > 0 ? service.slowMs : DEFAULT_SLOW_MS;

  if (httpStatus >= 400) {
    return { state: "down", reason: "HTTP " + httpStatus + "：服务可达，但接口返回错误", verified: true };
  }
  if (service.expectText && bodyText && bodyText.indexOf(service.expectText) < 0) {
    return {
      state: "degraded",
      reason: '响应内容与预期不符（未包含 "' + service.expectText + '"）',
      verified: true
    };
  }
  if (opaque) {
    return { state: "up", reason: "服务可达（未开放 CORS，状态码与响应内容未校验）", verified: false };
  }
  const matched = service.expectText ? bodyText.indexOf(service.expectText) >= 0 : true;
  if (latency >= slowMs) {
    return {
      state: "slow",
      reason: "响应正常，但耗时 " + latency + " ms ≥ " + slowMs + " ms",
      verified: matched
    };
  }
  return {
    state: "up",
    reason: matched && service.expectText ? "响应正常，内容匹配" : "响应正常",
    verified: matched
  };
}

/** 探测一个服务：发起请求 + 读取 Resource Timing + 给出判定 */
export async function probeService(service: ServiceConfig): Promise<ProbeResult> {
  const url = buildProbeUrl(service);
  const timeout = service.timeout && service.timeout > 0 ? service.timeout : DEFAULT_TIMEOUT;
  const startedAt = now();

  let attempt = await attemptFetch(url, "cors", timeout);
  let mode = "cors";
  if (!attempt.ok || !attempt.response) {
    // CORS 未开放时退化为不透明请求：只能确认可达，读不到状态码与内容
    const fallback = await attemptFetch(url, "no-cors", timeout);
    if (fallback.ok && fallback.response) {
      attempt = fallback;
      mode = "no-cors";
    }
  }

  if (!attempt.ok || !attempt.response) {
    const timing = await readTimingSettled(url, startedAt);
    return {
      serviceId: service.id,
      url: url,
      state: "down",
      reason: attempt.errorMessage,
      httpStatus: 0,
      opaque: false,
      bodyText: "",
      mode: mode,
      latency: timing.duration,
      timing: timing,
      verified: false,
      at: Date.now(),
      errorType: attempt.errorType,
      errorMessage: attempt.errorMessage
    };
  }

  const response = attempt.response;
  const opaque = response.type === "opaque" || mode === "no-cors";
  const httpStatus = opaque ? 0 : response.status;
  let bodyText = "";
  if (!opaque) {
    try {
      bodyText = await response.text();
    } catch (readError) {
      bodyText = "";
    }
  }

  // 响应体读完，Resource Timing 条目此时才可用
  const timing = await readTimingSettled(url, startedAt);
  const verdict = judgeState(service, httpStatus, bodyText, opaque, timing.duration);
  const reason =
    timing.duration <= 0 && verdict.state !== "down"
      ? verdict.reason + "（缓存命中，延迟数值不可靠）"
      : verdict.reason;

  return {
    serviceId: service.id,
    url: url,
    state: verdict.state,
    reason: reason,
    httpStatus: httpStatus,
    opaque: opaque,
    bodyText: shorten(bodyText, 120),
    mode: mode,
    latency: timing.duration,
    timing: timing,
    verified: verdict.verified,
    at: Date.now(),
    errorType: "",
    errorMessage: ""
  };
}
