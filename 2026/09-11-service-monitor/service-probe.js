var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const DEFAULT_TIMEOUT = 8000;
const DEFAULT_SLOW_MS = 800;
function round1(value) {
    return Math.round(value * 10) / 10;
}
function now() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
    }
    return Date.now();
}
function shorten(text, max) {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > max ? clean.slice(0, max) + "…" : clean;
}
export function buildProbeUrl(service) {
    if (service.cacheBust === false) {
        return service.url;
    }
    const parsed = new URL(service.url);
    parsed.searchParams.set("_ts", String(Date.now()));
    return parsed.toString();
}
function stripQuery(url) {
    const index = url.indexOf("?");
    return index < 0 ? url : url.slice(0, index);
}
function findResourceEntry(targetUrl) {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") {
        return null;
    }
    const entries = performance.getEntriesByType("resource");
    const base = stripQuery(targetUrl);
    let found = null;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (entry.name === targetUrl || stripQuery(entry.name) === base) {
            found = entry;
        }
    }
    return found;
}
function clockTiming(clockMs) {
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
export function readTiming(targetUrl, clockMs) {
    const entry = findResourceEntry(targetUrl);
    if (!entry) {
        return clockTiming(clockMs);
    }
    const detailed = entry.requestStart > 0 && entry.responseStart > 0;
    return {
        source: "resource-timing",
        duration: round1(entry.duration),
        dns: detailed ? round1(Math.max(0, entry.domainLookupEnd - entry.domainLookupStart)) : 0,
        connect: detailed ? round1(Math.max(0, entry.connectEnd - entry.connectStart)) : 0,
        tls: detailed && entry.secureConnectionStart > 0
            ? round1(Math.max(0, entry.connectEnd - entry.secureConnectionStart))
            : 0,
        ttfb: detailed ? round1(Math.max(0, entry.responseStart - entry.requestStart)) : 0,
        download: detailed ? round1(Math.max(0, entry.responseEnd - entry.responseStart)) : 0,
        transferSize: entry.transferSize > 0 ? entry.transferSize : 0,
        protocol: entry.nextHopProtocol ? entry.nextHopProtocol : "",
        detailed: detailed
    };
}
function classifyError(error) {
    const name = error && error.name ? String(error.name) : "";
    const message = error && error.message ? String(error.message) : "";
    if (name === "AbortError")
        return "timeout";
    if (name === "NotAllowedError")
        return "blocked";
    if (message.indexOf("Failed to fetch") >= 0)
        return "network-or-cors";
    if (message.toLowerCase().indexOf("fetch failed") >= 0)
        return "network-or-cors";
    if (message.indexOf("NetworkError") >= 0)
        return "network";
    if (message.indexOf("CORS") >= 0)
        return "cors";
    return "unknown";
}
function describeError(error, timeout) {
    const type = classifyError(error);
    if (type === "timeout")
        return "超时：" + timeout + " ms 内没有响应";
    if (type === "network-or-cors")
        return "无法连接：网络不可达，或被 CORS / 拦截插件阻止";
    if (type === "network")
        return "网络错误：DNS 解析失败或连接被拒绝";
    if (type === "cors")
        return "CORS 策略阻止";
    if (type === "blocked")
        return "请求被浏览器或扩展阻止";
    return error && error.message ? String(error.message) : "未知错误";
}
function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}
function readTimingSettled(targetUrl, startedAt) {
    return __awaiter(this, void 0, void 0, function* () {
        for (let i = 0; i < 4; i++) {
            const timing = readTiming(targetUrl, now() - startedAt);
            if (timing.source === "resource-timing") {
                return timing;
            }
            yield delay(40);
        }
        return readTiming(targetUrl, now() - startedAt);
    });
}
function attemptFetch(url, mode, timeout) {
    return __awaiter(this, void 0, void 0, function* () {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(function () {
            timedOut = true;
            controller.abort();
        }, timeout);
        try {
            const response = yield fetch(url, {
                method: "GET",
                mode: mode,
                cache: "no-store",
                credentials: "omit",
                redirect: "follow",
                signal: controller.signal
            });
            return { ok: true, response: response, errorType: "", errorMessage: "" };
        }
        catch (error) {
            const type = timedOut ? "timeout" : classifyError(error);
            return {
                ok: false,
                response: null,
                errorType: type,
                errorMessage: describeError(error, timeout)
            };
        }
        finally {
            clearTimeout(timer);
        }
    });
}
export function judgeState(service, httpStatus, bodyText, opaque, latency) {
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
export function probeService(service) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = buildProbeUrl(service);
        const timeout = service.timeout && service.timeout > 0 ? service.timeout : DEFAULT_TIMEOUT;
        const startedAt = now();
        let attempt = yield attemptFetch(url, "cors", timeout);
        let mode = "cors";
        if (!attempt.ok || !attempt.response) {
            const fallback = yield attemptFetch(url, "no-cors", timeout);
            if (fallback.ok && fallback.response) {
                attempt = fallback;
                mode = "no-cors";
            }
        }
        if (!attempt.ok || !attempt.response) {
            const timing = yield readTimingSettled(url, startedAt);
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
                bodyText = yield response.text();
            }
            catch (readError) {
                bodyText = "";
            }
        }
        const timing = yield readTimingSettled(url, startedAt);
        const verdict = judgeState(service, httpStatus, bodyText, opaque, timing.duration);
        const reason = timing.duration <= 0 && verdict.state !== "down"
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
    });
}
