/**
 * Weather Service - 天气 API 服务
 * 负责地理定位、天气数据获取、数据缓存
 *
 * 安全说明：
 * - 前端不再持有和风天气 API Key
 * - 通过同源代理接口 /api/weather 由服务端使用环境变量访问第三方 API
 */
const WeatherService = (() => {
    const WEATHER_PROXY_API = '/api/weather';

    const CACHE_TTL = {
        WEATHER: 30 * 60 * 1000,      // 30 分钟
        LOCATION: 24 * 60 * 60 * 1000 // 24 小时
    };

    let currentData = null;
    let animationEngine = null;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    // 和风天气代码到动画类型映射
    const CODE_TO_ANIMATION = {
        100: 'sunny', 102: 'sunny', 103: 'cloudy',
        101: 'cloudy', 104: 'overcast',
        150: 'night', 151: 'night', 152: 'night', 153: 'night',
        200: 'cloudy', 201: 'sunny', 202: 'cloudy', 203: 'cloudy',
        204: 'cloudy', 205: 'cloudy', 206: 'cloudy', 207: 'cloudy',
        208: 'overcast', 209: 'overcast', 210: 'thunder',
        211: 'thunder', 212: 'thunder', 213: 'thunder',
        300: 'rain', 301: 'rain', 302: 'thunder', 303: 'thunder',
        304: 'thunder', 305: 'rain', 306: 'rain', 307: 'rain',
        308: 'rain', 309: 'rain', 310: 'rain', 311: 'rain',
        312: 'rain', 313: 'rain', 314: 'rain', 315: 'rain',
        316: 'rain', 317: 'rain', 318: 'rain',
        350: 'rain', 351: 'rain', 399: 'rain',
        400: 'snow', 401: 'snow', 402: 'snow', 403: 'snow',
        404: 'snow', 405: 'snow', 406: 'snow', 407: 'snow',
        408: 'snow', 409: 'snow', 410: 'snow',
        456: 'snow', 457: 'snow', 499: 'snow',
        500: 'fog', 501: 'fog', 502: 'fog', 503: 'fog',
        504: 'fog', 507: 'fog', 508: 'fog',
        509: 'fog', 510: 'fog', 511: 'fog', 512: 'fog',
        513: 'fog', 514: 'fog', 515: 'fog',
        900: 'sunny', 901: 'overcast', 999: 'cloudy'
    };

    async function fetchJsonWithTimeout(url, { timeout = 6000 } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) {
                let errPayload = null;
                try {
                    errPayload = await res.clone().json();
                } catch {
                    // ignore invalid json body
                }

                const error = new Error(errPayload?.message || `HTTP ${res.status}`);
                error.httpStatus = res.status;
                error.apiCode = errPayload?.code;
                throw error;
            }
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    function createStorageTTLCache({ prefix, ttlMs, maxEntries = 100 }) {
        const normalizeKey = (key) => `${prefix}:${String(key)}`;

        const get = (key) => {
            const storageKey = normalizeKey(key);
            try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object') {
                    localStorage.removeItem(storageKey);
                    return null;
                }
                if (typeof parsed.timestamp !== 'number') {
                    localStorage.removeItem(storageKey);
                    return null;
                }
                if (Date.now() - parsed.timestamp > ttlMs) {
                    localStorage.removeItem(storageKey);
                    return null;
                }
                return parsed.value;
            } catch {
                return null;
            }
        };

        const cleanup = () => {
            try {
                const keys = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(`${prefix}:`)) keys.push(key);
                }
                if (keys.length <= maxEntries) return;

                keys
                    .map((k) => {
                        try {
                            const raw = localStorage.getItem(k);
                            const parsed = raw ? JSON.parse(raw) : null;
                            return { key: k, timestamp: Number(parsed?.timestamp || 0) };
                        } catch {
                            return { key: k, timestamp: 0 };
                        }
                    })
                    .sort((a, b) => a.timestamp - b.timestamp)
                    .slice(0, keys.length - maxEntries)
                    .forEach(({ key }) => localStorage.removeItem(key));
            } catch {
                // ignore cleanup failure
            }
        };

        const set = (key, value) => {
            const storageKey = normalizeKey(key);
            try {
                localStorage.setItem(storageKey, JSON.stringify({
                    value,
                    timestamp: Date.now()
                }));
                cleanup();
            } catch {
                // ignore storage failure
            }
        };

        return { get, set };
    }

    const weatherCache = createStorageTTLCache({
        prefix: 'ss_cache_weather',
        ttlMs: CACHE_TTL.WEATHER,
        maxEntries: 30
    });

    const locationCache = createStorageTTLCache({
        prefix: 'ss_cache_weather_location',
        ttlMs: CACHE_TTL.LOCATION,
        maxEntries: 20
    });

    function createDurationBuckets() {
        return {
            '0-200ms': 0,
            '200-500ms': 0,
            '500-1000ms': 0,
            '1000-3000ms': 0,
            '3000ms+': 0
        };
    }

    function getNowMs() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    function recordDurationBucket(bucketMap, durationMs) {
        if (!bucketMap || typeof durationMs !== 'number' || Number.isNaN(durationMs)) return;
        if (durationMs < 200) {
            bucketMap['0-200ms']++;
            return;
        }
        if (durationMs < 500) {
            bucketMap['200-500ms']++;
            return;
        }
        if (durationMs < 1000) {
            bucketMap['500-1000ms']++;
            return;
        }
        if (durationMs < 3000) {
            bucketMap['1000-3000ms']++;
            return;
        }
        bucketMap['3000ms+']++;
    }

    function classifyWeatherError(err) {
        if (err?.name === 'AbortError') return 'timeout';
        if (err?.httpStatus >= 500) return 'serverError';
        if (err?.httpStatus >= 400) return 'clientError';
        if (err?.apiCode === 42900) return 'clientError';
        if (err?.apiCode === 40001 || err?.apiCode === 40002) return 'clientError';
        return 'networkOrUnknown';
    }

    const weatherMetrics = {
        sessionStartAt: Date.now(),
        location: {
            cacheHit: 0,
            geolocation: {
                success: 0,
                fail: 0,
                durationBuckets: createDurationBuckets()
            },
            ipFallback: {
                success: 0,
                fail: 0,
                durationBuckets: createDurationBuckets()
            }
        },
        weatherApi: {
            success: 0,
            fail: 0,
            durationBuckets: createDurationBuckets(),
            timeout: 0,
            clientError: 0,
            serverError: 0,
            networkOrUnknown: 0
        },
        pipeline: {
            success: 0,
            fail: 0,
            cacheFallbackUsed: 0,
            retryScheduled: 0,
            durationBuckets: createDurationBuckets()
        },
        lastError: null
    };

    function updateLastError(scope, err, extra = {}) {
        weatherMetrics.lastError = {
            at: Date.now(),
            scope,
            message: String(err?.message || err || 'unknown error'),
            httpStatus: err?.httpStatus || null,
            apiCode: err?.apiCode || null,
            ...extra
        };
    }

    function cloneMetrics() {
        return JSON.parse(JSON.stringify(weatherMetrics));
    }

    function getMetricsSummary() {
        const apiTotal = weatherMetrics.weatherApi.success + weatherMetrics.weatherApi.fail;
        const pipelineTotal = weatherMetrics.pipeline.success + weatherMetrics.pipeline.fail;
        return {
            sessionStartAt: weatherMetrics.sessionStartAt,
            weatherApiSuccessRate: apiTotal > 0 ? Number((weatherMetrics.weatherApi.success / apiTotal).toFixed(4)) : null,
            pipelineSuccessRate: pipelineTotal > 0 ? Number((weatherMetrics.pipeline.success / pipelineTotal).toFixed(4)) : null,
            geolocationFallbackRate:
                weatherMetrics.location.geolocation.fail + weatherMetrics.location.geolocation.success > 0
                    ? Number((weatherMetrics.location.geolocation.fail / (weatherMetrics.location.geolocation.fail + weatherMetrics.location.geolocation.success)).toFixed(4))
                    : null,
            cacheFallbackUsed: weatherMetrics.pipeline.cacheFallbackUsed,
            retryScheduled: weatherMetrics.pipeline.retryScheduled,
            lastError: weatherMetrics.lastError
        };
    }

    function formatHourLabel(fxTime) {
        if (!fxTime) return '--:--';
        const date = new Date(fxTime);
        if (Number.isNaN(date.getTime())) return '--:--';
        return `${String(date.getHours()).padStart(2, '0')}:00`;
    }

    function formatWeekdayLabel(fxDate) {
        if (!fxDate) return '--';
        const date = new Date(`${fxDate}T00:00:00`);
        if (Number.isNaN(date.getTime())) return '--';
        return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    }

    function setTextContent(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = value;
    }

    function setSectionHidden(id, hidden) {
        const el = document.getElementById(id);
        if (!el) return;
        el.hidden = hidden;
    }

    function renderHourlyList(hourly24h = []) {
        const listEl = document.getElementById('weather-hourly-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        const picked = hourly24h.filter((_, idx) => idx % 3 === 0).slice(0, 8);
        if (!picked.length) {
            const empty = document.createElement('span');
            empty.className = 'weather-chip-empty';
            empty.textContent = '暂无数据';
            listEl.appendChild(empty);
            return;
        }

        picked.forEach((item) => {
            const chip = document.createElement('span');
            chip.className = 'weather-chip';
            const pop = item?.pop ? ` · ${item.pop}%` : '';
            chip.textContent = `${formatHourLabel(item?.fxTime)} ${item?.temp ?? '--'}°${pop}`;
            listEl.appendChild(chip);
        });
    }

    function renderDailyList(daily7d = []) {
        const listEl = document.getElementById('weather-daily-list');
        if (!listEl) return;

        listEl.innerHTML = '';

        const picked = daily7d.slice(0, 7);
        if (!picked.length) {
            const empty = document.createElement('span');
            empty.className = 'weather-chip-empty';
            empty.textContent = '暂无数据';
            listEl.appendChild(empty);
            return;
        }

        picked.forEach((item) => {
            const chip = document.createElement('span');
            chip.className = 'weather-chip';
            chip.textContent = `${formatWeekdayLabel(item?.fxDate)} ${item?.tempMin ?? '--'}~${item?.tempMax ?? '--'}°`;
            listEl.appendChild(chip);
        });
    }

    function renderWarning(warningList = [], warningSource = 'none') {
        const hasWarning = Array.isArray(warningList) && warningList.length > 0;
        setSectionHidden('weather-warning', !hasWarning);

        if (!hasWarning) return;

        const item = warningList[0] || {};
        setTextContent('weather-warning-main', item.title || `${item.typeName || '天气'}预警`);
        const sender = item.sender ? `${item.sender}` : '气象部门';
        const level = item.severity || '未知等级';
        const sourceTag = warningSource === 'v1' ? '新接口' : warningSource === 'v7-fallback' ? '旧接口兜底' : '未知来源';
        setTextContent('weather-warning-sub', `${sender} · ${level} · ${sourceTag}`);
    }

    function renderAir(airNow, airSource = 'none') {
        const hasAir = Boolean(airNow && typeof airNow === 'object');
        if (!hasAir) {
            setTextContent('weather-air-aqi', 'AQI --');
            setTextContent('weather-air-level', '--');
            setTextContent('weather-air-sub', 'PM2.5 -- · PM10 --');
            return;
        }

        const aqi = airNow.aqi ?? '--';
        const sourceTag = airSource === 'v1' ? '新接口' : airSource === 'v7-fallback' ? '旧接口兜底' : '未知来源';
        setTextContent('weather-air-aqi', `AQI ${aqi}`);
        setTextContent('weather-air-level', `${airNow.category || '--'} · ${sourceTag}`);
        setTextContent(
            'weather-air-sub',
            `PM2.5 ${airNow.pm2p5 ?? '--'} · PM10 ${airNow.pm10 ?? '--'}${airNow.primary ? ` · 首要污染物 ${airNow.primary}` : ''}`
        );
    }

    // 国旗 emoji 生成（ISO 3166-1 alpha-2 → 区域指示符号）
    function countryFlag(code) {
        if (!code || code.length !== 2) return '';
        return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)));
    }

    // 通过 IP 获取位置和城市名
    async function getLocationByIP() {
        const apis = [
            { url: 'https://ipapi.co/json/', lat: 'latitude', lon: 'longitude', city: 'city', country: 'country_name', code: 'country_code' },
            { url: 'https://ipinfo.io/json', lat: null, lon: null, city: 'city', country: 'country', code: 'country', parseLoc: true }
        ];

        const startedAt = getNowMs();

        const resolveLocationFromApi = async (api) => {
            const data = await fetchJsonWithTimeout(api.url, { timeout: 3500 });

            let lat;
            let lon;
            let city;
            let country;
            let countryCode;

            if (api.parseLoc && data.loc) {
                const [la, lo] = data.loc.split(',');
                lat = parseFloat(la);
                lon = parseFloat(lo);
                city = data.city;
                country = data.country;
                countryCode = data.country;
            } else {
                lat = data[api.lat];
                lon = data[api.lon];
                city = data[api.city];
                country = data[api.country];
                countryCode = data[api.code];
            }

            if (!lat || !lon) {
                throw new Error('invalid ip location payload');
            }

            return {
                lat: parseFloat(lat).toFixed(2),
                lon: parseFloat(lon).toFixed(2),
                city: city || '未知',
                country: country || '',
                countryCode: countryCode || '',
                timestamp: Date.now()
            };
        };

        try {
            const tasks = apis.map((api) => resolveLocationFromApi(api));

            let location = null;
            if (typeof Promise.any === 'function') {
                location = await Promise.any(tasks);
            } else {
                const results = await Promise.allSettled(tasks);
                const firstOk = results.find((res) => res.status === 'fulfilled');
                location = firstOk ? firstOk.value : null;
            }

            if (location) {
                locationCache.set('current', location);
                weatherMetrics.location.ipFallback.success++;
                recordDurationBucket(weatherMetrics.location.ipFallback.durationBuckets, getNowMs() - startedAt);
                return location;
            }
        } catch {
            // ignore and fall through
        }

        weatherMetrics.location.ipFallback.fail++;
        recordDurationBucket(weatherMetrics.location.ipFallback.durationBuckets, getNowMs() - startedAt);
        return null;
    }

    // 获取位置
    async function getLocation() {
        const cached = locationCache.get('current');
        if (cached) {
            weatherMetrics.location.cacheHit++;
            return cached;
        }

        const geolocationStartedAt = getNowMs();
        try {
            const pos = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation not supported'));
                    return;
                }

                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: false,
                    timeout: 8000,
                    maximumAge: 300000
                });
            });

            const location = {
                lat: pos.coords.latitude.toFixed(2),
                lon: pos.coords.longitude.toFixed(2),
                timestamp: Date.now()
            };
            locationCache.set('current', location);
            weatherMetrics.location.geolocation.success++;
            recordDurationBucket(weatherMetrics.location.geolocation.durationBuckets, getNowMs() - geolocationStartedAt);
            return location;
        } catch (err) {
            weatherMetrics.location.geolocation.fail++;
            recordDurationBucket(weatherMetrics.location.geolocation.durationBuckets, getNowMs() - geolocationStartedAt);
            updateLastError('geolocation', err);
            console.log('浏览器定位不可用，使用 IP 定位');
            const ipLocation = await getLocationByIP();
            if (ipLocation) return ipLocation;
        }

        return null;
    }

    // 获取天气数据（通过同源代理）
    async function fetchWeatherData(location) {
        const params = new URLSearchParams({
            lon: String(location.lon),
            lat: String(location.lat)
        });

        const startedAt = getNowMs();
        try {
            const data = await fetchJsonWithTimeout(`${WEATHER_PROXY_API}?${params.toString()}`, { timeout: 7000 });
            if (data.code !== 200 && data.code !== '200') {
                throw new Error(`Proxy API error: ${data.code}`);
            }

            const weatherData = {
                temp: data.weather.temp,
                feelsLike: data.weather.feelsLike,
                text: data.weather.text,
                icon: data.weather.icon,
                humidity: data.weather.humidity,
                windDir: data.weather.windDir,
                windScale: data.weather.windScale,
                hourly24h: Array.isArray(data.weather.hourly24h) ? data.weather.hourly24h : [],
                daily7d: Array.isArray(data.weather.daily7d) ? data.weather.daily7d : [],
                warningList: Array.isArray(data.warning?.list) ? data.warning.list : [],
                warningSource: data.warning?.source || 'none',
                airNow: data.air?.now || null,
                airSource: data.air?.source || 'none',
                city: data.city.city || location.city || '未知',
                country: data.city.country || location.country || '',
                countryCode: data.city.countryCode || location.countryCode || '',
                updateTime: data.weather.updateTime,
                timestamp: Date.now()
            };

            weatherMetrics.weatherApi.success++;
            recordDurationBucket(weatherMetrics.weatherApi.durationBuckets, getNowMs() - startedAt);
            return weatherData;
        } catch (err) {
            weatherMetrics.weatherApi.fail++;
            weatherMetrics.weatherApi[classifyWeatherError(err)]++;
            recordDurationBucket(weatherMetrics.weatherApi.durationBuckets, getNowMs() - startedAt);
            updateLastError('weatherApi', err, {
                lon: String(location?.lon || ''),
                lat: String(location?.lat || '')
            });
            throw err;
        }
    }

    // 解析动画类型
    function resolveAnimationType(iconCode) {
        const hour = new Date().getHours();
        const isNightTime = hour >= 19 || hour < 6;
        let type = CODE_TO_ANIMATION[iconCode] || 'cloudy';
        if (isNightTime && (type === 'sunny' || type === 'cloudy')) {
            type = 'night';
        }
        return type;
    }

    // 更新 UI
    function updateUI(data) {
        const iconEl = document.getElementById('weather-icon');
        const tempEl = document.getElementById('weather-temp');
        const cityEl = document.getElementById('weather-city');
        const countryEl = document.getElementById('weather-country');
        const descEl = document.getElementById('weather-desc');
        const feelsEl = document.getElementById('weather-feels');
        const humidityEl = document.getElementById('weather-humidity');
        const windEl = document.getElementById('weather-wind');

        if (iconEl) {
            const emojiMap = {
                100: '☀️', 101: '🌤️', 102: '🌤️', 103: '⛅',
                104: '☁️', 150: '🌙', 151: '🌙', 152: '🌙', 153: '🌙',
                300: '🌧️', 301: '🌧️', 302: '⛈️', 303: '⛈️', 304: '⛈️',
                305: '🌧️', 306: '🌧️', 307: '🌧️', 308: '🌧️', 309: '🌦️',
                310: '🌧️', 311: '🌧️', 312: '🌧️', 313: '🌧️', 399: '🌧️',
                400: '❄️', 401: '❄️', 402: '❄️', 403: '❄️', 404: '🌨️',
                405: '🌨️', 406: '🌨️', 407: '❄️', 499: '❄️',
                500: '🌫️', 501: '🌫️', 502: '🌫️', 503: '🌫️', 504: '🌫️',
                507: '🌫️', 508: '🌫️', 509: '🌫️', 510: '🌫️', 511: '🌫️',
                512: '🌫️', 513: '🌫️', 514: '🌫️', 515: '🌫️',
                900: '🔥', 901: '🥶', 999: '❓'
            };
            const emoji = emojiMap[data.icon] || '🌤️';

            const cdnUrl = `https://icons.qweather.com/assets/icons/${data.icon}.svg`;
            let loaded = false;

            iconEl.onload = () => {
                loaded = true;
            };
            iconEl.onerror = () => {
                if (!loaded) {
                    iconEl.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">${emoji}</text></svg>`;
                }
            };
            iconEl.src = cdnUrl;

            setTimeout(() => {
                if (!loaded) {
                    iconEl.onerror = null;
                    iconEl.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">${emoji}</text></svg>`;
                }
            }, 3000);
        }

        if (tempEl) tempEl.textContent = `${data.temp}°`;
        if (countryEl) {
            const flag = countryFlag(data.countryCode);
            countryEl.textContent = flag ? `${flag} ${data.country || ''}` : (data.country || '');
            countryEl.style.display = data.country ? '' : 'none';
        }
        if (cityEl) cityEl.textContent = data.city;
        if (descEl) descEl.textContent = data.text;
        if (feelsEl) feelsEl.textContent = `${data.feelsLike}°`;
        if (humidityEl) humidityEl.textContent = `${data.humidity}%`;
        if (windEl) windEl.textContent = `${data.windDir} ${data.windScale}级`;

        renderWarning(data.warningList || [], data.warningSource || 'none');
        renderAir(data.airNow || null, data.airSource || 'none');
        renderHourlyList(data.hourly24h || []);
        renderDailyList(data.daily7d || []);

        if (animationEngine) {
            const animType = resolveAnimationType(data.icon);
            animationEngine.setWeatherType(animType);
        }
    }


    function applyWeatherErrorState(err, { hasCachedData = false } = {}) {
        const cityEl = document.getElementById('weather-city');
        const descEl = document.getElementById('weather-desc');

        let message = '天气暂时不可用';

        if (err?.apiCode === 42900 || err?.httpStatus === 429) {
            message = '请求过于频繁，请稍后再试';
        } else if (err?.apiCode === 40001 || err?.apiCode === 40002 || err?.httpStatus === 400) {
            message = '定位参数异常，天气服务不可用';
        } else if (String(err?.message || '').includes('位置')) {
            message = '无法获取位置，请检查定位权限';
        }

        if (descEl) {
            descEl.textContent = hasCachedData ? `${message}（已展示缓存）` : message;
        }

        if (!hasCachedData && cityEl) {
            cityEl.textContent = '天气服务不可用';
        }
    }

    function shouldRetryWeather(err) {
        if (!err) return true;
        if (err.httpStatus === 400 || err.httpStatus === 429) return false;
        if (err.apiCode === 40001 || err.apiCode === 40002 || err.apiCode === 42900) return false;
        if (String(err.message || '').includes('位置')) return false;
        return true;
    }

    // 主获取流程
    async function fetchWeather() {
        const startedAt = getNowMs();
        try {
            const location = await getLocation();
            if (!location) throw new Error('无法获取位置信息');

            const data = await fetchWeatherData(location);
            currentData = data;
            weatherCache.set('current', data);
            updateUI(data);
            retryCount = 0;
            weatherMetrics.pipeline.success++;
            recordDurationBucket(weatherMetrics.pipeline.durationBuckets, getNowMs() - startedAt);
        } catch (err) {
            console.warn('天气获取失败:', err.message);
            weatherMetrics.pipeline.fail++;
            updateLastError('fetchWeather', err);

            const cached = weatherCache.get('current');
            const hasCachedData = Boolean(cached);

            if (hasCachedData) {
                weatherMetrics.pipeline.cacheFallbackUsed++;
                currentData = cached;
                updateUI(cached);
            }

            applyWeatherErrorState(err, { hasCachedData });

            if (retryCount < MAX_RETRIES && shouldRetryWeather(err)) {
                retryCount++;
                weatherMetrics.pipeline.retryScheduled++;
                setTimeout(fetchWeather, 5000 * retryCount);
            }
        }
    }

    // 小组件展开/收起
    function initWidgetToggle() {
        const widget = document.getElementById('weather-widget');
        const detail = document.getElementById('weather-detail');
        if (!widget || !detail) return;

        widget.addEventListener('click', (e) => {
            if (e.target.closest('.weather-settings-btn')) return;
            detail.classList.toggle('show');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.weather-widget')) {
                detail.classList.remove('show');
            }
        });
    }

    // 公开 API
    return {
        init(engine) {
            animationEngine = engine;

            initWidgetToggle();

            const cached = weatherCache.get('current');
            if (cached) {
                updateUI(cached);
            }

            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            const saveDataMode = Boolean(connection?.saveData);
            const refreshIntervalMs = saveDataMode ? CACHE_TTL.WEATHER * 2 : CACHE_TTL.WEATHER;

            const refreshWhenVisible = () => {
                if (document.hidden) return;
                fetchWeather();
            };

            refreshWhenVisible();

            const weatherTimer = setInterval(() => {
                refreshWhenVisible();
            }, refreshIntervalMs);

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    refreshWhenVisible();
                }
            });

            return () => {
                clearInterval(weatherTimer);
            };
        },

        // 兼容旧接口（已废弃）
        setApiKey() {
            console.warn('setApiKey 已废弃：请通过服务端环境变量 QWEATHER_API_KEY 配置');
        },

        // 兼容旧接口（已废弃）
        getApiKey() {
            return null;
        },

        getCurrentData() {
            return currentData;
        },

        getMetrics() {
            return cloneMetrics();
        },

        getMetricsSummary() {
            return getMetricsSummary();
        }
    };
})();

window.WeatherService = WeatherService;
