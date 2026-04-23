document.addEventListener('DOMContentLoaded', () => {
    // ========================================
    // 1. Theme Management
    // ========================================
    const themeToggle = document.getElementById('theme-toggle');

    const getPreferredTheme = () => {
        const saved = localStorage.getItem('theme');
        if (saved) return saved;
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        if (window._weatherEngine) {
            window._weatherEngine.onThemeChange(theme);
        }
    };

    // Apply saved or system theme
    applyTheme(getPreferredTheme());

    // Toggle theme
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            applyTheme(current === 'dark' ? 'light' : 'dark');
        });
    }

    // Listen for system theme changes
    window.matchMedia?.('(prefers-color-scheme: dark)')
        .addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        });

    // ========================================
    // 2. Render Bookmarks
    // ========================================
    const container = document.getElementById('bookmarks-container');

    const handleImageError = (img) => {
        img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM5OTkiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxsaW5lIHgxPSIxMiIgeTE9IjgiIHgyPSIxMiIgeTI9IjEyIi8+PGxpbmUgeD0iMTIiIHkxPSIxNiIgeDI9IjEyLjAxIiB5MT0iMTYiLz48L3N2Zz4=';
    };

    bookmarksData.forEach((category, index) => {
        const categoryGroup = document.createElement('div');
        categoryGroup.className = 'category-group';
        // Staggered animation delay
        categoryGroup.style.transitionDelay = `${index * 0.08}s`;

        const title = document.createElement('h2');
        title.className = 'category-title';
        title.textContent = category.name;

        const grid = document.createElement('div');
        grid.className = 'links-grid';

        category.sites.forEach(item => {
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
            grid.appendChild(link);
        });

        categoryGroup.appendChild(title);
        categoryGroup.appendChild(grid);
        container.appendChild(categoryGroup);
    });

    // ========================================
    // 3. Card Entry Animations
    // ========================================
    const animateCards = () => {
        const cards = document.querySelectorAll('.category-group');

        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        observer.unobserve(entry.target);
                    }
                });
            }, {
                threshold: 0.1,
                rootMargin: '0px 0px -30px 0px'
            });

            cards.forEach(card => observer.observe(card));
        } else {
            // Fallback: make all visible
            cards.forEach(card => card.classList.add('visible'));
        }
    };

    // Trigger after a tiny delay for smooth entry
    requestAnimationFrame(() => {
        requestAnimationFrame(animateCards);
    });

    // ========================================
    // 4. Time & Date & Greeting
    // ========================================
    const timeEl = document.getElementById('time');
    const dateEl = document.getElementById('date');
    const greetingText = document.getElementById('greeting-text');
    const greetingIcon = document.getElementById('greeting-icon');

    const updateTime = () => {
        const now = new Date();

        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }

        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' });
        }

        const updateGreeting = async () => {
            if (!greetingText || !greetingIcon) return;

            const hour = now.getHours();
            const dateStr = now.toISOString().split('T')[0];

            let isWorkDay = now.getDay() !== 0 && now.getDay() !== 6;

            try {
                const cached = localStorage.getItem(`holiday_${dateStr}`);
                if (cached) {
                    const status = JSON.parse(cached);
                    isWorkDay = (status === 0 || status === 3);
                } else {
                    const res = await fetch(`https://timor.tech/api/holiday/info/${dateStr}`);
                    const data = await res.json();
                    if (data.code === 0) {
                        const status = data.type.type;
                        isWorkDay = (status === 2 || status === 3);
                        localStorage.setItem(`holiday_${dateStr}`, JSON.stringify(status));
                    }
                }
            } catch (e) {
                console.log("节假日 API 调用失败，回退到普通周末判断", e);
            }

            let greeting = "";
            let icon = "";

            if (hour >= 22 || hour < 5) {
                greeting = isWorkDay ? "别卷了，早点休息。" : "夜深了，世界很安静。";
                icon = "✨";
            } else if (hour >= 5 && hour < 9) {
                greeting = isWorkDay ? "上午好，开启元气满满的一天！" : "早安，享受慵懒的清晨。";
                icon = "🌅";
            } else if (hour >= 9 && hour < 12) {
                greeting = isWorkDay ? "保持专注，高效工作。" : "慢慢来，生活不只有工作。";
                icon = "☕";
            } else if (hour >= 12 && hour < 14) {
                greeting = isWorkDay ? "午饭愉快，记得午睡。" : "美食和休息最配了。";
                icon = "🍱";
            } else if (hour >= 14 && hour < 18) {
                greeting = isWorkDay ? "加油，离下班不远了。" : "享受悠闲的午后时光。";
                icon = "🍵";
            } else if (hour >= 18 && hour < 22) {
                greeting = isWorkDay ? "下班快乐，享受属于你的时间。" : "别走太快，等等灵魂。";
                icon = "🌙";
            }

            greetingText.textContent = greeting;
            greetingIcon.textContent = icon;
        };

        updateGreeting();
    };

    setInterval(updateTime, 1000);
    updateTime();

    // ========================================
    // 5. Search Functionality
    // ========================================
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const engineSelector = document.getElementById('engine-selector');
    const engineDropdown = document.getElementById('engine-dropdown');
    const currentEngineIcon = document.getElementById('current-engine-icon');
    const engineOptions = document.querySelectorAll('.engine-option');

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

    // Toggle Dropdown
    engineSelector.addEventListener('click', (e) => {
        e.stopPropagation();
        engineDropdown.classList.toggle('show');
        engineSelector.classList.toggle('active');
    });

    // Close dropdown on outside click
    document.addEventListener('click', () => {
        engineDropdown.classList.remove('show');
        engineSelector.classList.remove('active');
    });

    // Handle Engine Selection
    engineOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const selectedEngine = option.dataset.engine;
            currentEngine = selectedEngine;

            currentEngineIcon.textContent = engineNames[selectedEngine];
            engineOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');

            engineDropdown.classList.remove('show');
            engineSelector.classList.remove('active');

            searchInput.focus();
        });
    });

    const performSearch = () => {
        const query = searchInput.value.trim();
        if (query) {
            window.open(engines[currentEngine] + encodeURIComponent(query), '_blank');
        }
    };

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // ========================================
    // 6. Keyboard Shortcuts
    // ========================================
    document.addEventListener('keydown', (e) => {
        // Slash to Focus Search
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
        }

        // Tab to Switch Engine (when search focused)
        if (e.key === 'Tab' && document.activeElement === searchInput) {
            e.preventDefault();

            const engineKeys = Object.keys(engines);
            const currentIndex = engineKeys.indexOf(currentEngine);
            const nextIndex = (currentIndex + 1) % engineKeys.length;
            const nextEngine = engineKeys[nextIndex];

            currentEngine = nextEngine;
            currentEngineIcon.textContent = engineNames[nextEngine];

            engineOptions.forEach(opt => {
                opt.classList.toggle('active', opt.dataset.engine === nextEngine);
            });
        }

        // Escape to blur
        if (e.key === 'Escape' && document.activeElement === searchInput) {
            searchInput.blur();
        }
    });

    // ========================================
    // 7. PWA Support (Conditional)
    // ========================================
    if (!window.location.protocol.includes('extension')) {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = 'manifest.webmanifest';
        document.head.appendChild(link);

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(registration => {
                        console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    })
                    .catch(err => {
                        console.log('ServiceWorker registration failed: ', err);
                    });
            });
        }
    }

    // ========================================
    // 8. Weather Animation
    // ========================================
    if (typeof WeatherAnimationEngine !== 'undefined' && typeof WeatherService !== 'undefined') {
        const canvas = document.getElementById('weather-canvas');
        if (canvas) {
            window._weatherEngine = new WeatherAnimationEngine(canvas);
            WeatherService.init(window._weatherEngine);
        }
    }

    // ========================================
    // 9. Weather Debug Panel (press W)
    // ========================================
    const weatherTypes = [
        { key: 'sunny',   label: '☀️ 晴天' },
        { key: 'cloudy',  label: '⛅ 多云' },
        { key: 'overcast',label: '☁️ 阴天' },
        { key: 'rain',    label: '🌧 下雨' },
        { key: 'snow',    label: '❄️ 下雪' },
        { key: 'fog',     label: '🌫 大雾' },
        { key: 'thunder', label: '⛈ 雷暴' },
        { key: 'night',   label: '🌙 夜晚' },
    ];

    let debugPanel = null;

    function toggleDebugPanel() {
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

        // Inject keyframes once
        if (!document.getElementById('debug-anim')) {
            const style = document.createElement('style');
            style.id = 'debug-anim';
            style.textContent = `@keyframes fadeUp{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
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
            btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.18)';
            btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,0.08)';
            btn.onclick = () => {
                if (window._weatherEngine) {
                    window._weatherEngine.setWeatherType(key);
                    document.body.classList.add('weather-active');
                }
            };
            debugPanel.appendChild(btn);
        });

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = `
            padding: 0.45rem 0.55rem; border-radius: 8px; border: none; cursor: pointer;
            font-size: 0.8rem; background: rgba(255,255,255,0.06); color: #94a3b8;
            transition: all 0.2s;
        `;
        closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(239,68,68,0.2)'; closeBtn.style.color = '#f87171'; };
        closeBtn.onmouseleave = () => { closeBtn.style.background = 'rgba(255,255,255,0.06)'; closeBtn.style.color = '#94a3b8'; };
        closeBtn.onclick = () => { debugPanel.remove(); debugPanel = null; };
        debugPanel.appendChild(closeBtn);

        document.body.appendChild(debugPanel);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'w' && document.activeElement !== searchInput && !e.ctrlKey && !e.metaKey) {
            toggleDebugPanel();
        }
    });
});
