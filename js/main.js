document.addEventListener('DOMContentLoaded', () => {
    const fetchJsonWithTimeout = async (url, { timeout = 5000 } = {}) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    };

    const createStorageTTLCache = ({ prefix, ttlMs, maxEntries = 100 }) => {
        const keyFor = (key) => `${prefix}_${key}`;

        const parse = (raw) => {
            try {
                const data = JSON.parse(raw);
                if (!data || typeof data !== 'object') return null;
                if (typeof data.expiresAt !== 'number') return null;
                return data;
            } catch {
                return null;
            }
        };

        const remove = (key) => {
            try {
                localStorage.removeItem(keyFor(key));
            } catch {
                // ignore storage failure
            }
        };

        const prune = () => {
            const now = Date.now();
            const records = [];

            for (let i = 0; i < localStorage.length; i++) {
                const storageKey = localStorage.key(i);
                if (!storageKey || !storageKey.startsWith(`${prefix}_`)) continue;

                const parsed = parse(localStorage.getItem(storageKey));
                if (!parsed || parsed.expiresAt <= now) {
                    localStorage.removeItem(storageKey);
                    continue;
                }

                records.push({
                    storageKey,
                    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
                });
            }

            if (records.length <= maxEntries) return;

            records
                .sort((a, b) => a.updatedAt - b.updatedAt)
                .slice(0, records.length - maxEntries)
                .forEach((item) => localStorage.removeItem(item.storageKey));
        };

        const get = (key) => {
            const cacheKey = keyFor(key);
            const parsed = parse(localStorage.getItem(cacheKey));
            if (!parsed) {
                localStorage.removeItem(cacheKey);
                return null;
            }

            if (parsed.expiresAt <= Date.now()) {
                localStorage.removeItem(cacheKey);
                return null;
            }

            return parsed.value;
        };

        const set = (key, value) => {
            const now = Date.now();
            const payload = {
                value,
                updatedAt: now,
                expiresAt: now + ttlMs
            };

            try {
                localStorage.setItem(keyFor(key), JSON.stringify(payload));
                prune();
            } catch {
                // ignore storage failure
            }
        };

        return {
            get,
            set,
            remove,
            prune
        };
    };

    const holidayCache = createStorageTTLCache({
        prefix: 'ss_cache_holiday',
        // 节假日信息变化频率很低，缓存 35 天并定期清理
        ttlMs: 35 * 24 * 60 * 60 * 1000,
        maxEntries: 150
    });

    const createToast = () => {
        const toastEl = document.getElementById('app-toast');
        let timer = null;

        const show = (text, duration = 1400) => {
            if (!toastEl) return;
            toastEl.textContent = text;
            toastEl.classList.add('show');
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                toastEl.classList.remove('show');
            }, duration);
        };

        return { show };
    };

    const appToast = createToast();

    const initTheme = () => {
        const themeToggle = document.getElementById('theme-toggle');
        const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
        const themeStorage = (() => {
            try {
                const testKey = '__ss_theme_test__';
                localStorage.setItem(testKey, '1');
                localStorage.removeItem(testKey);
                return {
                    get: () => localStorage.getItem('theme'),
                    set: (value) => localStorage.setItem('theme', value),
                    remove: () => localStorage.removeItem('theme')
                };
            } catch {
                let inMemoryTheme = null;
                return {
                    get: () => inMemoryTheme,
                    set: (value) => {
                        inMemoryTheme = String(value || '');
                    },
                    remove: () => {
                        inMemoryTheme = null;
                    }
                };
            }
        })();

        const getPreferredTheme = () => {
            const saved = themeStorage.get();
            if (saved) return saved;
            return mediaQuery?.matches ? 'dark' : 'light';
        };

        const applyTheme = (theme, { persist = true } = {}) => {
            document.documentElement.setAttribute('data-theme', theme);
            if (persist) {
                themeStorage.set(theme);
            }
            if (window._weatherEngine) {
                window._weatherEngine.onThemeChange(theme);
            }
        };

        applyTheme(getPreferredTheme(), { persist: false });

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme');
                const nextTheme = current === 'dark' ? 'light' : 'dark';
                applyTheme(nextTheme);
                appToast.show(nextTheme === 'dark' ? '已切换为深色主题' : '已切换为浅色主题', 1200);
            });
        }

        if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', (e) => {
                if (!themeStorage.get()) {
                    applyTheme(e.matches ? 'dark' : 'light', { persist: false });
                }
            });
        }
    };

    const initBookmarks = () => {
        const container = document.getElementById('bookmarks-container');
        if (!container || !Array.isArray(bookmarksData)) return;

        const handleImageError = (img) => {
            img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM5OTkiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxsaW5lIHgxPSIxMiIgeTE9IjgiIHgyPSIxMiIgeTI9IjEyIi8+PGxpbmUgeD0iMTIiIHkxPSIxNiIgeDI9IjEyLjAxIiB5MT0iMTYiLz48L3N2Zz4=';
        };

        const categoriesFragment = document.createDocumentFragment();

        bookmarksData.forEach((category, index) => {
            const categoryGroup = document.createElement('div');
            categoryGroup.className = 'category-group';
            categoryGroup.style.transitionDelay = `${index * 0.08}s`;

            const title = document.createElement('h2');
            title.className = 'category-title';
            title.textContent = category.name;

            const grid = document.createElement('div');
            grid.className = 'links-grid';

            const linksFragment = document.createDocumentFragment();
            category.sites.forEach((item) => {
                const link = document.createElement('a');
                link.href = item.url;
                link.className = 'link-item';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';

                const icon = document.createElement('img');
                icon.src = item.icon;
                icon.alt = item.name;
                icon.className = 'link-icon';
                icon.loading = 'lazy';
                icon.onerror = () => handleImageError(icon);

                const name = document.createElement('span');
                name.className = 'link-name';
                name.textContent = item.name;

                link.appendChild(icon);
                link.appendChild(name);
                linksFragment.appendChild(link);
            });

            grid.appendChild(linksFragment);
            categoryGroup.appendChild(title);
            categoryGroup.appendChild(grid);
            categoriesFragment.appendChild(categoryGroup);
        });

        container.appendChild(categoriesFragment);
    };

    const initCardAnimations = () => {
        const animateCards = () => {
            const cards = document.querySelectorAll('.category-group');

            if ('IntersectionObserver' in window) {
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            entry.target.classList.add('visible');
                            observer.unobserve(entry.target);
                        }
                    });
                }, {
                    threshold: 0.1,
                    rootMargin: '0px 0px -30px 0px'
                });

                cards.forEach((card) => observer.observe(card));
            } else {
                cards.forEach((card) => card.classList.add('visible'));
            }
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(animateCards);
        });
    };

    const initClockAndGreeting = () => {
        const timeEl = document.getElementById('time');
        const dateEl = document.getElementById('date');
        const greetingText = document.getElementById('greeting-text');
        const greetingIcon = document.getElementById('greeting-icon');

        const isWorkDayByHolidayType = (status, fallbackIsWeekday) => {
            // timor type 语义：0 工作日、1 周末、2 节假日、3 调休（补班）
            if (status === 0 || status === 3) return true;
            if (status === 1 || status === 2) return false;
            return fallbackIsWeekday;
        };

        const getHolidayStatus = async (dateStr) => {
            const cached = holidayCache.get(dateStr);
            if (cached !== null && typeof cached !== 'undefined') {
                const parsed = Number.parseInt(String(cached), 10);
                return Number.isNaN(parsed) ? null : parsed;
            }

            const data = await fetchJsonWithTimeout(`https://timor.tech/api/holiday/info/${dateStr}`, { timeout: 3500 });
            if (data.code === 0 && data.type && typeof data.type.type !== 'undefined') {
                const status = Number(data.type.type);
                if (!Number.isNaN(status)) {
                    holidayCache.set(dateStr, status);
                    return status;
                }
            }
            return null;
        };

        const renderClock = () => {
            const now = new Date();

            if (timeEl) {
                timeEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            }

            if (dateEl) {
                dateEl.textContent = now.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' });
            }
        };

        const updateGreeting = async () => {
            if (!greetingText || !greetingIcon) return;

            const now = new Date();
            const hour = now.getHours();
            const dateStr = now.toISOString().split('T')[0];

            const fallbackIsWeekday = now.getDay() !== 0 && now.getDay() !== 6;
            let isWorkDay = fallbackIsWeekday;

            try {
                const status = await getHolidayStatus(dateStr);
                isWorkDay = isWorkDayByHolidayType(status, fallbackIsWeekday);
            } catch (e) {
                console.log('节假日 API 调用失败，回退到普通周末判断', e);
            }

            let greeting = '';
            let icon = '';

            if (hour >= 22 || hour < 5) {
                greeting = isWorkDay ? '别卷了，早点休息。' : '夜深了，世界很安静。';
                icon = '✨';
            } else if (hour >= 5 && hour < 9) {
                greeting = isWorkDay ? '上午好，开启元气满满的一天！' : '早安，享受慵懒的清晨。';
                icon = '🌅';
            } else if (hour >= 9 && hour < 12) {
                greeting = isWorkDay ? '保持专注，高效工作。' : '慢慢来，生活不只有工作。';
                icon = '☕';
            } else if (hour >= 12 && hour < 14) {
                greeting = isWorkDay ? '午饭愉快，记得午睡。' : '美食和休息最配了。';
                icon = '🍱';
            } else if (hour >= 14 && hour < 18) {
                greeting = isWorkDay ? '加油，离下班不远了。' : '享受悠闲的午后时光。';
                icon = '🍵';
            } else if (hour >= 18 && hour < 22) {
                greeting = isWorkDay ? '下班快乐，享受属于你的时间。' : '别走太快，等等灵魂。';
                icon = '🌙';
            }

            greetingText.textContent = greeting;
            greetingIcon.textContent = icon;
        };

        renderClock();
        updateGreeting();

        const startClockTicker = () => {
            const tick = () => {
                renderClock();
                const now = new Date();
                const delay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
                setTimeout(tick, Math.max(200, delay));
            };

            const now = new Date();
            const initialDelay = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
            setTimeout(tick, Math.max(200, initialDelay));
        };

        startClockTicker();
        setInterval(updateGreeting, 10 * 60 * 1000);
    };

    const initSearch = () => {
        const searchInput = document.getElementById('search-input');
        const searchBtn = document.getElementById('search-btn');
        const engineSelector = document.getElementById('engine-selector');
        const engineDropdown = document.getElementById('engine-dropdown');
        const currentEngineIcon = document.getElementById('current-engine-icon');
        const engineOptions = document.querySelectorAll('.engine-option');

        if (!searchInput || !searchBtn || !engineSelector || !engineDropdown || !currentEngineIcon || !engineOptions.length) {
            return null;
        }

        let currentEngine = 'baidu';

        const engines = {
            baidu: 'https://www.baidu.com/s?wd=',
            bing: 'https://cn.bing.com/search?q=',
            google: 'https://www.google.com/search?q='
        };

        const engineNames = {
            baidu: '百度',
            bing: 'Bing',
            google: 'Google'
        };

        const syncEngineUI = () => {
            currentEngineIcon.textContent = engineNames[currentEngine];
            engineOptions.forEach((opt) => {
                const selected = opt.dataset.engine === currentEngine;
                opt.classList.toggle('active', selected);
                opt.setAttribute('aria-selected', String(selected));
            });
        };

        const closeDropdown = () => {
            engineDropdown.classList.remove('show');
            engineSelector.classList.remove('active');
            engineSelector.setAttribute('aria-expanded', 'false');
        };

        const openDropdown = () => {
            engineDropdown.classList.add('show');
            engineSelector.classList.add('active');
            engineSelector.setAttribute('aria-expanded', 'true');
        };

        const performSearch = () => {
            const query = searchInput.value.trim();
            if (query) {
                window.open(engines[currentEngine] + encodeURIComponent(query), '_blank');
            }
        };

        const cycleEngine = ({ showFeedback = true } = {}) => {
            const engineKeys = Object.keys(engines);
            const currentIndex = engineKeys.indexOf(currentEngine);
            const nextIndex = (currentIndex + 1) % engineKeys.length;
            currentEngine = engineKeys[nextIndex];
            syncEngineUI();
            if (showFeedback) {
                appToast.show(`搜索引擎：${engineNames[currentEngine]}`);
            }
        };

        engineSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            if (engineDropdown.classList.contains('show')) {
                closeDropdown();
            } else {
                openDropdown();
            }
        });

        engineSelector.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (engineDropdown.classList.contains('show')) closeDropdown();
                else openDropdown();
            }
        });

        document.addEventListener('click', closeDropdown);

        engineOptions.forEach((option) => {
            option.setAttribute('tabindex', '0');
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const selectedEngine = option.dataset.engine;
                if (selectedEngine && engines[selectedEngine]) {
                    currentEngine = selectedEngine;
                    appToast.show(`搜索引擎：${engineNames[currentEngine]}`);
                }
                syncEngineUI();
                closeDropdown();
                searchInput.focus();
            });

            option.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    option.click();
                }
            });
        });

        searchBtn.addEventListener('click', performSearch);
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch();
        });

        syncEngineUI();

        return {
            searchInput,
            cycleEngine
        };
    };

    const initKeyboardShortcuts = (searchModule) => {
        const searchInput = searchModule?.searchInput || null;

        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && searchInput && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput.focus();
            }

            if (e.key === 'Tab' && searchInput && document.activeElement === searchInput) {
                e.preventDefault();
                searchModule?.cycleEngine?.({ showFeedback: true });
            }

            if (e.key === 'Escape' && searchInput && document.activeElement === searchInput) {
                searchInput.blur();
            }
        });
    };

    const initPWA = () => {
        if (window.location.protocol.includes('extension')) return;

        if (!document.querySelector('link[rel="manifest"]')) {
            const link = document.createElement('link');
            link.rel = 'manifest';
            link.href = 'manifest.webmanifest';
            document.head.appendChild(link);
        }

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then((registration) => {
                        console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    })
                    .catch((err) => {
                        console.log('ServiceWorker registration failed: ', err);
                    });
            });
        }
    };

    const initWeather = () => {
        if (typeof WeatherAnimationEngine === 'undefined' || typeof WeatherService === 'undefined') return;

        const canvas = document.getElementById('weather-canvas');
        if (!canvas) return;

        window._weatherEngine = new WeatherAnimationEngine(canvas);
        WeatherService.init(window._weatherEngine);
    };

    const initMobileToolbarAutoHide = () => {
        const toolbar = document.querySelector('.floating-toolbar');
        if (!toolbar) return;

        const mediaQuery = window.matchMedia('(max-width: 480px)');
        let ticking = false;
        let hidden = false;

        const applyHiddenState = () => {
            if (!mediaQuery.matches) {
                toolbar.classList.remove('is-hidden');
                hidden = false;
                return;
            }

            const shouldHide = window.scrollY > 18;
            if (shouldHide === hidden) return;
            hidden = shouldHide;
            toolbar.classList.toggle('is-hidden', hidden);
        };

        const onScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                applyHiddenState();
                ticking = false;
            });
        };

        const onMediaChange = () => {
            applyHiddenState();
        };

        window.addEventListener('scroll', onScroll, { passive: true });

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', onMediaChange);
        } else if (typeof mediaQuery.addListener === 'function') {
            mediaQuery.addListener(onMediaChange);
        }

        applyHiddenState();
    };

    const initWeatherWidgetA11y = () => {
        const widget = document.getElementById('weather-widget');
        const detail = document.getElementById('weather-detail');
        if (!widget || !detail) return;

        const syncExpanded = () => {
            widget.setAttribute('aria-expanded', String(detail.classList.contains('show')));
        };

        widget.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                detail.classList.toggle('show');
                syncExpanded();
            }
            if (e.key === 'Escape') {
                detail.classList.remove('show');
                syncExpanded();
            }
        });

        // 点击行为由 weather.js 负责开关，这里只做 ARIA 状态同步
        widget.addEventListener('click', syncExpanded);

        // 监听 class 变化，覆盖“点击外部关闭”等路径，确保 aria-expanded 始终准确
        const observer = new MutationObserver(syncExpanded);
        observer.observe(detail, { attributes: true, attributeFilter: ['class'] });

        syncExpanded();
    };

    const initWeatherDebugPanel = (searchModule) => {
        const searchInput = searchModule?.searchInput || null;
        const DEBUG_WEATHER_PARAM = 'debugWeather';
        const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
        const forceEnable = new URLSearchParams(window.location.search).get(DEBUG_WEATHER_PARAM) === '1';
        const debugEnabled = isLocalHost || forceEnable;

        if (!debugEnabled) return;

        const weatherTypes = [
            { key: 'sunny', label: '☀️ 晴天' },
            { key: 'cloudy', label: '⛅ 多云' },
            { key: 'overcast', label: '☁️ 阴天' },
            { key: 'rain', label: '🌧 下雨' },
            { key: 'snow', label: '❄️ 下雪' },
            { key: 'fog', label: '🌫 大雾' },
            { key: 'thunder', label: '⛈ 雷暴' },
            { key: 'night', label: '🌙 夜晚' }
        ];

        let debugPanel = null;

        const toggleDebugPanel = () => {
            if (debugPanel) {
                debugPanel.remove();
                debugPanel = null;
                return;
            }

            debugPanel = document.createElement('div');
            debugPanel.style.cssText = `
                position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
                display: flex; gap: 0.5rem; padding: 0.6rem 0.8rem;
                background: rgba(15,23,42,0.4); backdrop-filter: blur(30px) saturate(160%);
                border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
                z-index: 9999; animation: fadeUp 0.25s ease both;
            `;

            if (!document.getElementById('debug-anim')) {
                const style = document.createElement('style');
                style.id = 'debug-anim';
                style.textContent = '@keyframes fadeUp{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
                document.head.appendChild(style);
            }

            weatherTypes.forEach(({ key, label }) => {
                const btn = document.createElement('button');
                btn.textContent = label;
                btn.style.cssText = `
                    padding: 0.45rem 0.7rem; border-radius: 8px; border: none; cursor: pointer;
                    font-size: 0.8rem; font-family: inherit; white-space: nowrap;
                    background: rgba(255,255,255,0.08); color: #e2e8f0;
                    transition: all 0.2s;
                `;
                btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.18)'; };
                btn.onmouseleave = () => { btn.style.background = 'rgba(255,255,255,0.08)'; };
                btn.onclick = () => {
                    if (window._weatherEngine) {
                        window._weatherEngine.setWeatherType(key);
                        document.body.classList.add('weather-active');
                    }
                };
                debugPanel.appendChild(btn);
            });

            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = `
                padding: 0.45rem 0.55rem; border-radius: 8px; border: none; cursor: pointer;
                font-size: 0.8rem; background: rgba(255,255,255,0.06); color: #94a3b8;
                transition: all 0.2s;
            `;
            closeBtn.onmouseenter = () => {
                closeBtn.style.background = 'rgba(239,68,68,0.2)';
                closeBtn.style.color = '#f87171';
            };
            closeBtn.onmouseleave = () => {
                closeBtn.style.background = 'rgba(255,255,255,0.06)';
                closeBtn.style.color = '#94a3b8';
            };
            closeBtn.onclick = () => {
                debugPanel.remove();
                debugPanel = null;
            };
            debugPanel.appendChild(closeBtn);

            document.body.appendChild(debugPanel);
        };

        document.addEventListener('keydown', (e) => {
            const isTypingInSearch = !!searchInput && document.activeElement === searchInput;
            if (e.key === 'w' && !isTypingInSearch && !e.ctrlKey && !e.metaKey) {
                toggleDebugPanel();
            }
        });
    };

    initTheme();
    initBookmarks();
    initCardAnimations();
    initClockAndGreeting();
    const searchModule = initSearch();
    initKeyboardShortcuts(searchModule);
    initPWA();
    initWeather();
    initMobileToolbarAutoHide();
    initWeatherWidgetA11y();
    initWeatherDebugPanel(searchModule);
});
