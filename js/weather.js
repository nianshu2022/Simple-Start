/**
 * Weather Service - 天气 API 服务
 * 负责地理定位、和风天气 API 调用、数据缓存
 */
const WeatherService = (() => {
    const API_BASE = 'https://devapi.qweather.com';
    const GEO_API = 'https://geoapi.qweather.com';

    const CACHE_KEY = 'weather_cache';
    const LOCATION_CACHE_KEY = 'weather_location';
    const API_KEY_KEY = 'qweather_api_key';
    const CACHE_DURATION = 30 * 60 * 1000;        // 30 分钟
    const LOCATION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 小时

    let apiKey = '7011495e34e84766bc2e734cd4d3c070';
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

    // 缓存操作
    function getCached(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch { return null; }
    }

    function setCache(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch {}
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
            { url: 'https://ipinfo.io/json', lat: null, lon: null, city: 'city', country: 'country', code: 'country', parseLoc: true },
        ];
        for (const api of apis) {
            try {
                const res = await fetch(api.url);
                const data = await res.json();
                let lat, lon, city, country, countryCode;
                if (api.parseLoc && data.loc) {
                    const [la, lo] = data.loc.split(',');
                    lat = parseFloat(la); lon = parseFloat(lo); city = data.city;
                    countryCode = data.country;
                } else {
                    lat = data[api.lat]; lon = data[api.lon]; city = data[api.city];
                    country = data[api.country];
                    countryCode = data[api.code];
                }
                if (lat && lon) {
                    const location = {
                        lat: parseFloat(lat).toFixed(2),
                        lon: parseFloat(lon).toFixed(2),
                        city: city || '未知',
                        country: country || '',
                        countryCode: countryCode || '',
                        timestamp: Date.now()
                    };
                    setCache(LOCATION_CACHE_KEY, location);
                    return location;
                }
            } catch { continue; }
        }
        return null;
    }

    // 获取位置
    async function getLocation() {
        // 先检查缓存
        const cached = getCached(LOCATION_CACHE_KEY);
        if (cached && Date.now() - cached.timestamp < LOCATION_CACHE_DURATION) {
            return cached;
        }

        // 尝试浏览器定位
        try {
            const pos = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation not supported'));
                    return;
                }
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: false, timeout: 10000, maximumAge: 300000
                });
            });
            const location = {
                lat: pos.coords.latitude.toFixed(2),
                lon: pos.coords.longitude.toFixed(2),
                timestamp: Date.now()
            };
            setCache(LOCATION_CACHE_KEY, location);
            return location;
        } catch {
            // 浏览器定位失败，使用 IP 定位
            console.log('浏览器定位不可用，使用 IP 定位');
            const ipLocation = await getLocationByIP();
            if (ipLocation) return ipLocation;
        }

        return null;
    }

    // 获取城市和国家信息
    async function fetchCity(location) {
        try {
            const res = await fetch(`${GEO_API}/v2/city/lookup?location=${location.lon},${location.lat}&key=${apiKey}`);
            const data = await res.json();
            if ((data.code === '200' || data.code === 200) && data.location?.length) {
                const loc = data.location[0];
                return {
                    city: loc.name,
                    country: loc.country || '',
                    countryCode: loc.countryCode || location.countryCode || ''
                };
            }
        } catch {}
        return {
            city: location.city || '未知',
            country: location.country || '',
            countryCode: location.countryCode || ''
        };
    }

    // 获取天气数据
    async function fetchWeatherData(location) {
        const locationStr = `${location.lon},${location.lat}`;

        const [weatherRes, city] = await Promise.all([
            fetch(`${API_BASE}/v7/weather/now?location=${locationStr}&key=${apiKey}`),
            fetchCity(location)
        ]);

        const weatherData = await weatherRes.json();
        if (weatherData.code !== '200' && weatherData.code !== 200) {
            throw new Error(`API error: ${weatherData.code}`);
        }

        return {
            temp: weatherData.now.temp,
            feelsLike: weatherData.now.feelsLike,
            text: weatherData.now.text,
            icon: weatherData.now.icon,
            humidity: weatherData.now.humidity,
            windDir: weatherData.now.windDir,
            windScale: weatherData.now.windScale,
            city: city.city,
            country: city.country,
            countryCode: city.countryCode,
            updateTime: weatherData.updateTime,
            timestamp: Date.now()
        };
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
        const widget = document.getElementById('weather-widget');

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

            // 先尝试 CDN，3 秒后 fallback 到 emoji
            const cdnUrl = `https://icons.qweather.com/assets/icons/${data.icon}.svg`;
            let loaded = false;

            iconEl.onload = () => { loaded = true; };
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

        // 更新动画
        if (animationEngine) {
            const animType = resolveAnimationType(data.icon);
            animationEngine.setWeatherType(animType);
        }

        // 切换到有数据状态
        if (widget) widget.classList.remove('no-key');
    }

    // 主获取流程
    async function fetchWeather() {
        if (!apiKey) return;

        try {
            const location = await getLocation();
            if (!location) throw new Error('无法获取位置信息');
            const data = await fetchWeatherData(location);
            currentData = data;
            setCache(CACHE_KEY, { data, timestamp: Date.now() });
            updateUI(data);
            retryCount = 0;
        } catch (err) {
            console.warn('天气获取失败:', err.message);

            // 尝试使用缓存
            const cached = getCached(CACHE_KEY);
            if (cached?.data) {
                currentData = cached.data;
                updateUI(cached.data);
            }

            // 重试（仅网络错误时重试）
            if (retryCount < MAX_RETRIES && !err.message.includes('位置')) {
                retryCount++;
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

            // 读取缓存的 API Key
            const cachedKey = getCached(API_KEY_KEY);
            if (cachedKey) apiKey = cachedKey;

            // 初始化 UI 交互
            initWidgetToggle();

            const widget = document.getElementById('weather-widget');

            // 如果有 API Key，显示加载状态
            if (apiKey) {
                if (widget) widget.classList.remove('no-key');
            }

            // 读取缓存数据立即渲染
            const cached = getCached(CACHE_KEY);
            if (cached?.data && Date.now() - cached.timestamp < CACHE_DURATION) {
                updateUI(cached.data);
            }

            // 如果有 API Key，获取最新数据
            if (apiKey) {
                fetchWeather();
            }

            // 定时刷新
            setInterval(() => {
                if (apiKey) fetchWeather();
            }, CACHE_DURATION);
        },

        setApiKey(key) {
            apiKey = key;
            setCache(API_KEY_KEY, key);
            fetchWeather();
        },

        getApiKey() { return apiKey; },
        getCurrentData() { return currentData; }
    };
})();

window.WeatherService = WeatherService;
