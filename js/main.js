document.addEventListener('DOMContentLoaded', () => {
    // 1. Render Bookmarks
    const container = document.getElementById('bookmarks-container');

    // Function to handle favicon loading errors
    const handleImageError = (img) => {
        img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM5OTkiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxsaW5lIHgxPSIxMiIgeTE9IjgiIHgyPSIxMiIgeTI9IjEyIi8+PGxpbmUgeD0iMTIiIHkxPSIxNiIgeDI9IjEyLjAxIiB5MT0iMTYiLz48L3N2Zz4='; // Default icon
    };

    bookmarksData.forEach(category => {
        const categoryGroup = document.createElement('div');
        categoryGroup.className = 'category-group';

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

    // 2. Time & Date & Greeting
    const timeEl = document.getElementById('time');
    const dateEl = document.getElementById('date');
    const greetingText = document.getElementById('greeting-text');
    const greetingIcon = document.getElementById('greeting-icon');

    const updateTime = () => {
        const now = new Date();

        // Time
        if (timeEl) {
            timeEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }

        // Date
        if (dateEl) {
            dateEl.textContent = now.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }

        // Greeting
        const updateGreeting = async () => {
            if (!greetingText || !greetingIcon) return;

            const hour = now.getHours();
            const dateStr = now.toISOString().split('T')[0];

            // 1. 获取日期状态 (0: 工作日, 1: 休息日, 2: 节假日, 3: 节假日调休上班)
            // 简单逻辑：0 和 3 是“打工人模式”，1 和 2 是“休息模式”
            let isWorkDay = now.getDay() !== 0 && now.getDay() !== 6;

            try {
                const cached = localStorage.getItem(`holiday_${dateStr}`);
                if (cached) {
                    const status = JSON.parse(cached);
                    isWorkDay = (status === 0 || status === 3);
                } else {
                    // 使用提摩科技的免费 API (仅在非扩展环境下由于 CORS 限制可能失效，增加错误处理)
                    const res = await fetch(`https://timor.tech/api/holiday/info/${dateStr}`);
                    const data = await res.json();
                    if (data.code === 0) {
                        const status = data.type.type; // 0: 休息日, 1: 节假日, 2: 工作日, 3: 调休
                        // 转换一下逻辑：API 的 0,1 是休，2,3 是班
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

    // 3. Search Functionality (Unified Pill)
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

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        engineDropdown.classList.remove('show');
        engineSelector.classList.remove('active');
    });

    // Handle Engine Selection
    engineOptions.forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent closing immediately
            const selectedEngine = option.dataset.engine;
            currentEngine = selectedEngine;

            // Update UI
            currentEngineIcon.textContent = engineNames[selectedEngine];
            engineOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');

            // Close dropdown
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

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // 1. Slash to Focus
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
        }

        // 2. Tab to Switch Engine (when focused)
        if (e.key === 'Tab' && document.activeElement === searchInput) {
            e.preventDefault();

            const engineKeys = Object.keys(engines);
            const currentIndex = engineKeys.indexOf(currentEngine);
            const nextIndex = (currentIndex + 1) % engineKeys.length;
            const nextEngine = engineKeys[nextIndex];

            // Update State
            currentEngine = nextEngine;

            // Update UI
            currentEngineIcon.textContent = engineNames[nextEngine];

            // Update Dropdown Selection State
            engineOptions.forEach(opt => {
                if (opt.dataset.engine === nextEngine) {
                    opt.classList.add('active');
                } else {
                    opt.classList.remove('active');
                }
            });
        }
    });

    // 4. Dark Mode Toggle (Safe Implementation)
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggle.textContent = newTheme === 'dark' ? '浅色模式' : '深色模式';
        });
    }

    // Detect system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (themeToggle) themeToggle.textContent = '浅色模式';
    }
    // 5. PWA Support (Conditional)
    // Only run if NOT in a Chrome Extension environment to avoid "Blocked By Response" errors
    if (!window.location.protocol.includes('extension')) {
        // A. Inject Manifest dynamically
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = 'manifest.webmanifest';
        document.head.appendChild(link);

        // B. Register Service Worker
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
});
