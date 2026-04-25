const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

function jsonError(httpStatus, code, message, details) {
    return Response.json(
        {
            code,
            message,
            ...(details ? { details } : {})
        },
        { status: httpStatus }
    );
}

function getClientIp(request) {
    const cfIp = request.headers.get('CF-Connecting-IP');
    if (cfIp) return cfIp.trim();

    const xff = request.headers.get('X-Forwarded-For');
    if (xff) return xff.split(',')[0].trim();

    return 'unknown';
}

function checkRateLimit(request) {
    const now = Date.now();
    const ip = getClientIp(request);

    if (!globalThis.__weatherRateLimitStore) {
        globalThis.__weatherRateLimitStore = new Map();
    }
    const store = globalThis.__weatherRateLimitStore;

    const record = store.get(ip);
    if (!record || now - record.windowStart >= RATE_LIMIT_WINDOW_MS) {
        store.set(ip, { windowStart: now, count: 1 });
    } else {
        record.count += 1;
        store.set(ip, record);
    }

    // 轻量清理，避免 map 持续增长
    if (store.size > 2000) {
        for (const [key, value] of store.entries()) {
            if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) {
                store.delete(key);
            }
        }
    }

    const current = store.get(ip);
    return current.count <= RATE_LIMIT_MAX_REQUESTS;
}

function parseCoordinate(value, { min, max }) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    // 只允许普通十进制数字，避免异常格式
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;

    const num = Number.parseFloat(trimmed);
    if (!Number.isFinite(num)) return null;
    if (num < min || num > max) return null;

    return num;
}

export async function onRequestGet(context) {
    const { request, env } = context;

    const API_KEY = env.QWEATHER_API_KEY;
    if (!API_KEY) {
        return jsonError(500, 50001, 'Server weather key is not configured');
    }

    if (!checkRateLimit(request)) {
        return jsonError(429, 42900, 'Too many requests, please try again later');
    }

    const url = new URL(request.url);
    const lonRaw = url.searchParams.get('lon');
    const latRaw = url.searchParams.get('lat');

    if (!lonRaw || !latRaw) {
        return jsonError(400, 40001, 'Missing lon/lat parameters');
    }

    const lon = parseCoordinate(lonRaw, { min: -180, max: 180 });
    const lat = parseCoordinate(latRaw, { min: -90, max: 90 });

    if (lon === null || lat === null) {
        return jsonError(400, 40002, 'Invalid lon/lat range or format');
    }

    try {
        const location = `${lon.toFixed(2)},${lat.toFixed(2)}`;
        const latitude = lat.toFixed(2);
        const longitude = lon.toFixed(2);

        const weatherNowUrl = `https://devapi.qweather.com/v7/weather/now?location=${encodeURIComponent(location)}&key=${encodeURIComponent(API_KEY)}`;
        const weather24hUrl = `https://devapi.qweather.com/v7/weather/24h?location=${encodeURIComponent(location)}&key=${encodeURIComponent(API_KEY)}`;
        const weather7dUrl = `https://devapi.qweather.com/v7/weather/7d?location=${encodeURIComponent(location)}&key=${encodeURIComponent(API_KEY)}`;
        const cityUrl = `https://geoapi.qweather.com/v2/city/lookup?location=${encodeURIComponent(location)}&key=${encodeURIComponent(API_KEY)}`;

        // 新接口优先，旧接口兜底
        const warningCandidateUrls = [
            `https://devapi.qweather.com/weatheralert/v1/current/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}?key=${encodeURIComponent(API_KEY)}`,
            `https://devapi.qweather.com/v7/warning/now?location=${encodeURIComponent(location)}&key=${encodeURIComponent(API_KEY)}`
        ];

        const airCandidateUrls = [
            `https://devapi.qweather.com/airquality/v1/current/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}?key=${encodeURIComponent(API_KEY)}`,
            `https://devapi.qweather.com/v7/air/now?location=${encodeURIComponent(location)}&key=${encodeURIComponent(API_KEY)}`
        ];

        const [weatherNowRes, cityRes] = await Promise.all([
            fetch(weatherNowUrl),
            fetch(cityUrl)
        ]);

        if (!weatherNowRes.ok || !cityRes.ok) {
            return jsonError(502, 50201, 'Upstream weather service unavailable');
        }

        const weatherNowData = await weatherNowRes.json();
        const cityData = await cityRes.json();

        if (String(weatherNowData.code) !== '200') {
            return jsonError(502, 50202, 'Weather provider returned error', {
                upstreamCode: weatherNowData.code || 'unknown'
            });
        }

        const fetchOptionalJson = async (requestUrl) => {
            try {
                const res = await fetch(requestUrl);
                if (!res || !res.ok) return null;
                const data = await res.json();
                if (typeof data?.code === 'undefined') return data;
                return String(data?.code) === '200' ? data : null;
            } catch {
                return null;
            }
        };

        const fetchOptionalWithFallback = async (candidates) => {
            for (let i = 0; i < candidates.length; i++) {
                const data = await fetchOptionalJson(candidates[i]);
                if (data) {
                    return { data, sourceIndex: i };
                }
            }
            return { data: null, sourceIndex: -1 };
        };

        const [weather24hData, weather7dData, warningResult, airResult] = await Promise.all([
            fetchOptionalJson(weather24hUrl),
            fetchOptionalJson(weather7dUrl),
            fetchOptionalWithFallback(warningCandidateUrls),
            fetchOptionalWithFallback(airCandidateUrls)
        ]);

        const warningData = warningResult.data;
        const airNowData = airResult.data;

        const pickArray = (value) => (Array.isArray(value) ? value : []);

        const warningListRaw =
            pickArray(warningData?.warning).length
                ? warningData.warning
                : pickArray(warningData?.alert).length
                    ? warningData.alert
                    : pickArray(warningData?.alerts).length
                        ? warningData.alerts
                        : pickArray(warningData?.list).length
                            ? warningData.list
                            : pickArray(warningData?.data?.alerts).length
                                ? warningData.data.alerts
                                : [];

        const firstAirObj = (() => {
            if (airNowData?.now && typeof airNowData.now === 'object') return airNowData.now;
            if (airNowData?.current && typeof airNowData.current === 'object') return airNowData.current;
            if (airNowData?.air && typeof airNowData.air === 'object') return airNowData.air;
            if (Array.isArray(airNowData?.indexes) && airNowData.indexes.length > 0) return airNowData.indexes[0];
            if (Array.isArray(airNowData?.data) && airNowData.data.length > 0) return airNowData.data[0];
            return null;
        })();

        const locationData = cityData?.location?.[0] || {};

        const payload = {
            code: 200,
            weather: {
                temp: weatherNowData?.now?.temp,
                feelsLike: weatherNowData?.now?.feelsLike,
                text: weatherNowData?.now?.text,
                icon: Number(weatherNowData?.now?.icon),
                humidity: weatherNowData?.now?.humidity,
                windDir: weatherNowData?.now?.windDir,
                windScale: weatherNowData?.now?.windScale,
                updateTime: weatherNowData?.updateTime,
                hourly24h: Array.isArray(weather24hData?.hourly)
                    ? weather24hData.hourly.slice(0, 24).map((item) => ({
                        fxTime: item?.fxTime,
                        temp: item?.temp,
                        text: item?.text,
                        icon: Number(item?.icon),
                        pop: item?.pop
                    }))
                    : [],
                daily7d: Array.isArray(weather7dData?.daily)
                    ? weather7dData.daily.slice(0, 7).map((item) => ({
                        fxDate: item?.fxDate,
                        tempMin: item?.tempMin,
                        tempMax: item?.tempMax,
                        textDay: item?.textDay,
                        textNight: item?.textNight,
                        iconDay: Number(item?.iconDay),
                        iconNight: Number(item?.iconNight),
                        precip: item?.precip,
                        humidity: item?.humidity
                    }))
                    : []
            },
            warning: {
                source: warningResult.sourceIndex === 0 ? 'v1' : warningResult.sourceIndex === 1 ? 'v7-fallback' : 'none',
                list: warningListRaw.map((item) => ({
                    id: item?.id || item?.alertId || item?.warnId,
                    sender: item?.sender || item?.senderName || item?.publisher,
                    pubTime: item?.pubTime || item?.publishTime || item?.startTime,
                    title: item?.title || item?.headline || item?.name,
                    text: item?.text || item?.description || item?.content,
                    severityColor: item?.severityColor || item?.color,
                    severity: item?.severity || item?.level,
                    type: item?.type || item?.typeCode,
                    typeName: item?.typeName || item?.typeText || item?.category
                }))
            },
            air: {
                source: airResult.sourceIndex === 0 ? 'v1' : airResult.sourceIndex === 1 ? 'v7-fallback' : 'none',
                now: firstAirObj
                    ? {
                        aqi: firstAirObj?.aqi,
                        category: firstAirObj?.category || firstAirObj?.level || firstAirObj?.aqiCategory,
                        primary: firstAirObj?.primary || firstAirObj?.primaryPollutant,
                        pm2p5: firstAirObj?.pm2p5 || firstAirObj?.pm25,
                        pm10: firstAirObj?.pm10,
                        no2: firstAirObj?.no2,
                        so2: firstAirObj?.so2,
                        co: firstAirObj?.co,
                        o3: firstAirObj?.o3,
                        pubTime: firstAirObj?.pubTime || firstAirObj?.publishTime || airNowData?.updateTime
                    }
                    : null
            },
            city: {
                city: locationData?.name || '',
                country: locationData?.country || '',
                countryCode: locationData?.countryCode || ''
            }
        };

        return Response.json(payload, {
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=300'
            }
        });
    } catch (error) {
        return jsonError(500, 50002, 'Weather proxy failed', {
            reason: String(error?.message || error)
        });
    }
}
