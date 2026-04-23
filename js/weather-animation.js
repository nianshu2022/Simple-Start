/**
 * Weather Animation Engine - Canvas 天气动画引擎
 * 支持 8 种天气场景的全屏逼真动画效果
 * v2 - 增强云朵体积感、雨滴深度与水花涟漪
 */

// ==================== Simplex Noise ====================
class SimplexNoise {
    constructor(seed = Math.random()) {
        this.grad3 = [
            [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
            [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
            [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
        ];
        this.p = [];
        for (let i = 0; i < 256; i++) this.p[i] = Math.floor(seed * 256 + i) % 256;
        this.perm = [];
        for (let i = 0; i < 512; i++) this.perm[i] = this.p[i & 255];
    }

    dot(g, x, y) { return g[0] * x + g[1] * y; }

    noise2D(xin, yin) {
        const F2 = 0.5 * (Math.sqrt(3) - 1);
        const G2 = (3 - Math.sqrt(3)) / 6;
        let s = (xin + yin) * F2;
        let i = Math.floor(xin + s), j = Math.floor(yin + s);
        let t = (i + j) * G2;
        let X0 = i - t, Y0 = j - t;
        let x0 = xin - X0, y0 = yin - Y0;
        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
        let x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        let x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
        let ii = i & 255, jj = j & 255;
        let gi0 = this.perm[ii + this.perm[jj]] % 12;
        let gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
        let gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
        let n0 = 0, n1 = 0, n2 = 0;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * this.dot(this.grad3[gi0], x0, y0); }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * this.dot(this.grad3[gi1], x1, y1); }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * this.dot(this.grad3[gi2], x2, y2); }
        return 70 * (n0 + n1 + n2);
    }

    fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
        let sum = 0, amp = 1, freq = 1, max = 0;
        for (let i = 0; i < octaves; i++) {
            sum += this.noise2D(x * freq, y * freq) * amp;
            max += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / max;
    }
}

// ==================== 引擎主体 ====================
class WeatherAnimationEngine {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.currentScene = null;
        this.nextScene = null;
        this.transitioning = false;
        this.transitionProgress = 0;
        this.transitionDuration = 1500;
        this.running = false;
        this.lastTime = 0;
        this.fps = 0;
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.theme = document.documentElement.getAttribute('data-theme') || 'light';
        this.resizeTimer = null;
        this.noise = new SimplexNoise(42);

        this.scenes = {
            sunny: new SunnyScene(this),
            cloudy: new CloudyScene(this),
            overcast: new OvercastScene(this),
            rain: new RainScene(this),
            snow: new SnowScene(this),
            fog: new FogScene(this),
            thunder: new ThunderScene(this),
            night: new NightScene(this)
        };

        this.foregroundCanvas = document.getElementById('weather-foreground');
        this.foregroundCtx = this.foregroundCanvas ? this.foregroundCanvas.getContext('2d') : null;
        this.currentForeground = null;
        this.foregrounds = {};
        if (this.foregroundCtx) {
            this.foregrounds = {
                rain: new RainForeground(this),
                snow: new SnowForeground(this),
                thunder: new ThunderForeground(this),
                fog: new FogForeground(this),
                night: new NightForeground(this)
            };
        }

        this.resize();
        this.bindEvents();
        if (this.reducedMotion) this.renderStaticFallback();
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * dpr;
        this.canvas.height = window.innerHeight * dpr;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.w = window.innerWidth;
        this.h = window.innerHeight;

        Object.values(this.scenes).forEach(scene => scene.resize(this.w, this.h));

        if (this.foregroundCanvas) {
            this.foregroundCanvas.width = window.innerWidth * dpr;
            this.foregroundCanvas.height = window.innerHeight * dpr;
            this.foregroundCanvas.style.width = window.innerWidth + 'px';
            this.foregroundCanvas.style.height = window.innerHeight + 'px';
            this.foregroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            Object.values(this.foregrounds).forEach(fg => fg.resize(this.w, this.h));
        }
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = setTimeout(() => this.resize(), 150);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.stop();
            else if (this.currentScene) this.start();
        });
    }

    setWeatherType(type) {
        const scene = this.scenes[type];
        if (!scene) return;

        if (!this.currentScene) {
            this.currentScene = scene;
            this.currentScene.init();
            this.currentForeground = this.foregrounds[type] || null;
            if (this.currentForeground) this.currentForeground.init();
            if (type === 'thunder' && this.scenes.thunder) {
                this.scenes.thunder.foreground = this.foregrounds.thunder || null;
            }
            this.start();
            document.body.classList.add('weather-active');
            return;
        }
        if (this.currentScene === scene) return;

        this.nextScene = scene;
        this.nextScene.init();
        this.nextForeground = this.foregrounds[type] || null;
        if (this.nextForeground) this.nextForeground.init();
        if (type === 'thunder' && this.scenes.thunder) {
            this.scenes.thunder.foreground = this.foregrounds.thunder || null;
        }
        this.transitioning = true;
        this.transitionProgress = 0;
    }

    onThemeChange(theme) {
        this.theme = theme;
        if (this.currentScene) this.currentScene.onThemeChange(theme);
        Object.values(this.foregrounds).forEach(fg => {
            if (fg.onThemeChange) fg.onThemeChange(theme);
        });
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.lastFpsTime = this.lastTime;
        this.frameCount = 0;
        this.loop(this.lastTime);
    }

    stop() { this.running = false; }

    loop(timestamp) {
        if (!this.running) return;
        const dt = Math.min(timestamp - this.lastTime, 50);
        this.lastTime = timestamp;

        this.frameCount++;
        if (timestamp - this.lastFpsTime >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsTime = timestamp;
        }

        if (!this.currentScene) {
            requestAnimationFrame(t => this.loop(t));
            return;
        }

        this.ctx.clearRect(0, 0, this.w, this.h);

        if (this.transitioning) {
            this.transitionProgress += dt / this.transitionDuration;
            if (this.transitionProgress >= 1) {
                this.transitionProgress = 1;
                this.transitioning = false;
                this.currentScene = this.nextScene;
                this.nextScene = null;
                this.currentForeground = this.nextForeground || null;
                this.nextForeground = null;
            } else {
                this.ctx.globalAlpha = 1 - this.transitionProgress;
                this.currentScene.update(dt);
                this.currentScene.render();
                this.ctx.globalAlpha = this.transitionProgress;
                this.nextScene.update(dt);
                this.nextScene.render();
                this.ctx.globalAlpha = 1;
            }
        } else {
            this.currentScene.update(dt);
            this.currentScene.render();
        }

        if (this.foregroundCtx) {
            this.foregroundCtx.clearRect(0, 0, this.w, this.h);
            if (this.transitioning) {
                if (this.currentForeground) {
                    this.foregroundCtx.globalAlpha = 1 - this.transitionProgress;
                    this.currentForeground.update(dt);
                    this.currentForeground.render(this.foregroundCtx);
                }
                if (this.nextForeground) {
                    this.foregroundCtx.globalAlpha = this.transitionProgress;
                    this.nextForeground.update(dt);
                    this.nextForeground.render(this.foregroundCtx);
                }
                this.foregroundCtx.globalAlpha = 1;
            } else if (this.currentForeground) {
                this.currentForeground.update(dt);
                this.currentForeground.render(this.foregroundCtx);
            }
        }

        requestAnimationFrame(t => this.loop(t));
    }

    renderStaticFallback() {
        if (!this.currentScene) return;
        this.ctx.clearRect(0, 0, this.w, this.h);
        this.currentScene.renderBackground();
    }

    destroy() {
        this.stop();
        window.removeEventListener('resize', this.resize);
    }
}

// ==================== 基础场景类 ====================
class BaseScene {
    constructor(engine) {
        this.engine = engine;
        this.ctx = engine.ctx;
        this.w = engine.w;
        this.h = engine.h;
        this.initialized = false;
    }
    init() { if (!this.initialized) { this.initialized = true; this.setup(); } }
    setup() {}
    update(dt) {}
    render() {}
    onThemeChange(theme) {}
    resize(w, h) { this.w = w; this.h = h; }
    getThemeColors() { return { isDark: this.engine.theme === 'dark' }; }
    renderBackground() { this.render(); }
}

// ==================== 晴天场景 ====================
class SunnyScene extends BaseScene {
    setup() {
        this.sunAngle = 0;
        this.rayAngle = 0;
        this.dustParticles = [];
        for (let i = 0; i < 20; i++) {
            this.dustParticles.push({
                x: Math.random() * this.w,
                y: Math.random() * this.h,
                size: Math.random() * 2.5 + 0.5,
                speed: Math.random() * 0.3 + 0.1,
                opacity: Math.random() * 0.3 + 0.1,
                phase: Math.random() * Math.PI * 2
            });
        }
    }

    update(dt) {
        this.sunAngle += 0.0005 * dt;
        this.rayAngle += 0.001 * dt;
        this.dustParticles.forEach(p => {
            p.x += p.speed * dt * 0.03;
            p.y += Math.sin(p.x * 0.01 + p.phase) * 0.3;
            if (p.x > this.w + 10) { p.x = -10; p.y = Math.random() * this.h; }
        });
    }

    render() {
        const { isDark } = this.getThemeColors();
        const ctx = this.ctx;

        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        if (isDark) {
            grad.addColorStop(0, '#0a1628');
            grad.addColorStop(0.5, '#0f2040');
            grad.addColorStop(1, '#162840');
        } else {
            grad.addColorStop(0, '#3a7bd5');
            grad.addColorStop(0.35, '#6db3f2');
            grad.addColorStop(0.7, '#87CEEB');
            grad.addColorStop(1, '#b8e4f9');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        const sunX = this.w * 0.78;
        const sunY = this.h * 0.18;
        const sunR = 55;

        // 大范围光晕
        const glowOuter = ctx.createRadialGradient(sunX, sunY, sunR * 0.3, sunX, sunY, sunR * 5);
        if (isDark) {
            glowOuter.addColorStop(0, 'rgba(255, 200, 80, 0.12)');
            glowOuter.addColorStop(0.5, 'rgba(255, 180, 60, 0.04)');
            glowOuter.addColorStop(1, 'rgba(255, 160, 40, 0)');
        } else {
            glowOuter.addColorStop(0, 'rgba(255, 230, 120, 0.25)');
            glowOuter.addColorStop(0.4, 'rgba(255, 210, 80, 0.1)');
            glowOuter.addColorStop(1, 'rgba(255, 200, 60, 0)');
        }
        ctx.fillStyle = glowOuter;
        ctx.fillRect(0, 0, this.w, this.h);

        // 光芒射线
        ctx.save();
        ctx.translate(sunX, sunY);
        ctx.rotate(this.rayAngle);
        for (let i = 0; i < 12; i++) {
            ctx.rotate(Math.PI / 6);
            ctx.beginPath();
            ctx.moveTo(sunR * 0.9, 0);
            ctx.lineTo(sunR * 3, -6);
            ctx.lineTo(sunR * 3, 6);
            ctx.closePath();
            ctx.fillStyle = isDark ? 'rgba(255, 200, 100, 0.04)' : 'rgba(255, 240, 160, 0.08)';
            ctx.fill();
        }
        ctx.restore();

        // 太阳本体
        const sunGrad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
        if (isDark) {
            sunGrad.addColorStop(0, '#ffe088');
            sunGrad.addColorStop(0.7, '#ddb840');
            sunGrad.addColorStop(1, '#bb8800');
        } else {
            sunGrad.addColorStop(0, '#fffbe8');
            sunGrad.addColorStop(0.6, '#ffe55c');
            sunGrad.addColorStop(1, '#f5a623');
        }
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        ctx.fillStyle = sunGrad;
        ctx.fill();

        // 浮尘粒子
        this.dustParticles.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = isDark ? `rgba(200, 210, 255, ${p.opacity * 0.4})` : `rgba(255, 255, 255, ${p.opacity})`;
            ctx.fill();
        });
    }
}

// ==================== 云朵工具 ====================
const CloudRenderer = {
    /**
     * 绘制一个逼真的体积云
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx 云中心 x
     * @param {number} cy 云中心 y
     * @param {number} w  云宽
     * @param {number} h  云高
     * @param {number} opacity 整体透明度
     * @param {boolean} isDark
     * @param {number} time 动画时间（用于形态微变）
     * @param {object} noise SimplexNoise 实例
     */
    drawCloud(ctx, cx, cy, w, h, opacity, isDark, time, noise) {
        ctx.save();
        ctx.globalAlpha = opacity;

        // 云由多个随机圆形 blob 组成，用噪点控制位置偏移
        const blobCount = Math.floor(w / 18) + 4;
        const seed = cx * 0.01 + cy * 0.007;

        // 先画阴影层（底部偏移）
        const shadowOffset = h * 0.15;
        for (let i = 0; i < blobCount; i++) {
            const t = i / (blobCount - 1);
            const angle = t * Math.PI;
            const bx = cx + Math.cos(angle) * w * 0.38 * (0.8 + 0.4 * noise.noise2D(seed + i * 3.7, time * 0.0001));
            const by = cy + Math.sin(angle) * h * 0.3 + shadowOffset;
            const br = (h * 0.35 + h * 0.25 * Math.abs(noise.noise2D(seed + i * 2.1, 0))) * (0.7 + 0.3 * Math.sin(angle));

            const shGrad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
            if (isDark) {
                shGrad.addColorStop(0, 'rgba(40, 55, 80, 0.15)');
                shGrad.addColorStop(1, 'rgba(40, 55, 80, 0)');
            } else {
                shGrad.addColorStop(0, 'rgba(100, 130, 170, 0.12)');
                shGrad.addColorStop(1, 'rgba(100, 130, 170, 0)');
            }
            ctx.fillStyle = shGrad;
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
        }

        // 主体层
        for (let i = 0; i < blobCount; i++) {
            const t = i / (blobCount - 1);
            const angle = t * Math.PI;
            const nOff = noise.noise2D(seed + i * 3.7, time * 0.00015);
            const bx = cx + Math.cos(angle) * w * 0.38 * (0.8 + 0.4 * nOff);
            const by = cy + Math.sin(angle) * h * 0.28;
            const br = (h * 0.38 + h * 0.22 * Math.abs(noise.noise2D(seed + i * 2.1, 1))) * (0.7 + 0.3 * Math.sin(angle));

            const grad = ctx.createRadialGradient(bx, by - br * 0.3, br * 0.1, bx, by, br);
            if (isDark) {
                grad.addColorStop(0, 'rgba(140, 160, 200, 0.35)');
                grad.addColorStop(0.5, 'rgba(110, 130, 170, 0.2)');
                grad.addColorStop(1, 'rgba(80, 100, 140, 0)');
            } else {
                grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
                grad.addColorStop(0.4, 'rgba(240, 248, 255, 0.7)');
                grad.addColorStop(0.75, 'rgba(220, 235, 250, 0.3)');
                grad.addColorStop(1, 'rgba(200, 220, 240, 0)');
            }
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
        }

        // 高光层（顶部小亮斑）
        for (let i = 0; i < Math.floor(blobCount * 0.5); i++) {
            const t = (i + 0.5) / (blobCount * 0.5);
            const angle = t * Math.PI;
            const bx = cx + Math.cos(angle) * w * 0.3;
            const by = cy - h * 0.1 + Math.sin(angle) * h * 0.1;
            const br = h * 0.18 * (0.6 + 0.4 * Math.abs(noise.noise2D(seed + i * 5.3, 2)));

            const hlGrad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
            if (isDark) {
                hlGrad.addColorStop(0, 'rgba(180, 200, 230, 0.12)');
                hlGrad.addColorStop(1, 'rgba(180, 200, 230, 0)');
            } else {
                hlGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
                hlGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            }
            ctx.fillStyle = hlGrad;
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
};

// ==================== 多云场景 ====================
class CloudyScene extends BaseScene {
    setup() {
        this.time = 0;
        this.clouds = [];
        const count = Math.max(5, Math.floor(this.w / 180));
        for (let i = 0; i < count; i++) {
            this.clouds.push(this.createCloud(i, count));
        }
    }

    createCloud(index, total) {
        const layer = Math.floor(Math.random() * 3); // 0=远 1=中 2=近
        const depthScale = [0.5, 0.75, 1][layer];
        const baseW = (Math.random() * 200 + 180) * depthScale;
        return {
            x: Math.random() * (this.w + baseW) - baseW * 0.5,
            y: Math.random() * this.h * 0.45 + this.h * 0.05 * layer,
            w: baseW,
            h: baseW * (0.3 + Math.random() * 0.15),
            speed: (Math.random() * 0.3 + 0.12) * depthScale * (Math.random() < 0.5 ? 1 : -1),
            opacity: (0.3 + Math.random() * 0.3) * (layer === 0 ? 0.5 : layer === 1 ? 0.7 : 1),
            layer: layer,
            seed: Math.random() * 1000
        };
    }

    update(dt) {
        this.time += dt;
        this.clouds.forEach(c => {
            c.x += c.speed * dt * 0.025;
            if (c.speed > 0 && c.x > this.w + c.w) { c.x = -c.w; c.y = Math.random() * this.h * 0.45 + this.h * 0.05 * c.layer; }
            if (c.speed < 0 && c.x < -c.w) { c.x = this.w + c.w; c.y = Math.random() * this.h * 0.45 + this.h * 0.05 * c.layer; }
        });
    }

    render() {
        const { isDark } = this.getThemeColors();
        const ctx = this.ctx;
        const noise = this.engine.noise;

        // 天空渐变
        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        if (isDark) {
            grad.addColorStop(0, '#1a2332');
            grad.addColorStop(0.5, '#1e2d42');
            grad.addColorStop(1, '#2a3a4a');
        } else {
            grad.addColorStop(0, '#5b93c9');
            grad.addColorStop(0.3, '#7fb5e0');
            grad.addColorStop(0.7, '#a8d4f0');
            grad.addColorStop(1, '#c8dff0');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        // 按层级排序绘制（远的先画）
        const sorted = [...this.clouds].sort((a, b) => a.layer - b.layer);
        sorted.forEach(c => {
            CloudRenderer.drawCloud(ctx, c.x + c.w / 2, c.y + c.h / 2, c.w, c.h, c.opacity, isDark, this.time + c.seed, noise);
        });
    }
}

// ==================== 阴天场景 ====================
class OvercastScene extends BaseScene {
    setup() {
        this.time = 0;
        this.cloudLayers = [];
        for (let i = 0; i < 10; i++) {
            const layer = Math.floor(i / 3.3);
            const depthScale = [0.4, 0.65, 1][layer] || 1;
            const baseW = (Math.random() * 350 + 250) * depthScale;
            this.cloudLayers.push({
                x: Math.random() * this.w * 2 - this.w * 0.5,
                y: Math.random() * this.h * 0.55,
                w: baseW,
                h: baseW * (0.25 + Math.random() * 0.12),
                speed: (Math.random() * 0.12 + 0.04) * depthScale * (i % 2 === 0 ? 1 : -1),
                opacity: (0.15 + Math.random() * 0.2) * (layer === 0 ? 0.5 : layer === 1 ? 0.7 : 1),
                layer: layer,
                seed: Math.random() * 1000
            });
        }
    }

    update(dt) {
        this.time += dt;
        this.cloudLayers.forEach(c => {
            c.x += c.speed * dt * 0.02;
            if (c.speed > 0 && c.x > this.w + c.w) c.x = -c.w;
            if (c.speed < 0 && c.x < -c.w) c.x = this.w + c.w;
        });
    }

    render() {
        const { isDark } = this.getThemeColors();
        const ctx = this.ctx;
        const noise = this.engine.noise;

        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        if (isDark) {
            grad.addColorStop(0, '#142030');
            grad.addColorStop(1, '#1e3048');
        } else {
            grad.addColorStop(0, '#5a7a9e');
            grad.addColorStop(0.5, '#7a94ac');
            grad.addColorStop(1, '#8aa0b8');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        // 整体灰蒙蒙的覆盖
        ctx.fillStyle = isDark ? 'rgba(30, 40, 60, 0.15)' : 'rgba(160, 180, 200, 0.15)';
        ctx.fillRect(0, 0, this.w, this.h);

        const sorted = [...this.cloudLayers].sort((a, b) => a.layer - b.layer);
        sorted.forEach(c => {
            CloudRenderer.drawCloud(ctx, c.x + c.w / 2, c.y + c.h / 2, c.w, c.h, c.opacity, isDark, this.time + c.seed, noise);
        });
    }
}

// ==================== 水花涟漪系统 ====================
class RippleSystem {
    constructor() {
        this.ripples = [];
    }

    add(x, y, size) {
        this.ripples.push({
            x, y,
            radius: 1,
            maxRadius: size * (3 + Math.random() * 3),
            life: 1,
            speed: 0.8 + Math.random() * 0.5
        });
    }

    update(dt) {
        const factor = dt / 16.67;
        this.ripples = this.ripples.filter(r => {
            r.radius += r.speed * factor;
            r.life = 1 - r.radius / r.maxRadius;
            return r.life > 0;
        });
    }

    render(ctx, isDark) {
        this.ripples.forEach(r => {
            ctx.save();
            ctx.globalAlpha = r.life * (isDark ? 0.25 : 0.35);
            ctx.strokeStyle = isDark ? 'rgba(150, 180, 220, 0.6)' : 'rgba(200, 220, 255, 0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            // 椭圆形涟漪（模拟透视）
            ctx.ellipse(r.x, r.y, r.radius, r.radius * 0.35, 0, 0, Math.PI * 2);
            ctx.stroke();
            // 内圈
            if (r.radius > 3) {
                ctx.globalAlpha = r.life * (isDark ? 0.12 : 0.18);
                ctx.beginPath();
                ctx.ellipse(r.x, r.y, r.radius * 0.6, r.radius * 0.2, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
        });
    }
}

// ==================== 雨天场景 ====================
class RainScene extends BaseScene {
    setup() {
        this.time = 0;
        this.ripples = new RippleSystem();
        this.windForce = 2.5;
        this.groundY = this.h - 4;

        // 多层雨滴（远处小慢，近处大快）
        this.layers = [
            { count: 60,  speedRange: [4, 7],   lenRange: [6, 10],   opacityRange: [0.1, 0.18], widthRange: [0.6, 0.8] },  // 远
            { count: 100, speedRange: [8, 13],  lenRange: [12, 20],  opacityRange: [0.15, 0.28], widthRange: [0.8, 1.2] }, // 中
            { count: 80,  speedRange: [14, 20], lenRange: [22, 38],  opacityRange: [0.2, 0.38], widthRange: [1.2, 1.8] }   // 近
        ];

        this.raindrops = [];
        this.layers.forEach((layer, li) => {
            for (let i = 0; i < layer.count; i++) {
                this.raindrops.push(this.createRaindrop(layer, li, true));
            }
        });

        // 水花粒子
        this.splashParticles = [];
    }

    createRaindrop(layer, layerIndex, randomY = false) {
        const sr = layer.speedRange;
        const lr = layer.lenRange;
        const or = layer.opacityRange;
        const wr = layer.widthRange;
        return {
            x: Math.random() * (this.w + 150) - 75,
            y: randomY ? Math.random() * this.h : -(Math.random() * this.h * 0.3 + lr[1]),
            speed: sr[0] + Math.random() * (sr[1] - sr[0]),
            length: lr[0] + Math.random() * (lr[1] - lr[0]),
            opacity: or[0] + Math.random() * (or[1] - or[0]),
            width: wr[0] + Math.random() * (wr[1] - wr[0]),
            layer: layerIndex
        };
    }

    update(dt) {
        const factor = dt / 16.67;
        this.time += dt;

        this.raindrops.forEach(r => {
            r.y += r.speed * factor;
            r.x += this.windForce * factor * (0.8 + r.layer * 0.15);

            if (r.y > this.groundY) {
                // 近层雨滴产生涟漪和水花
                if (r.layer >= 1 && Math.random() < (r.layer === 2 ? 0.5 : 0.25)) {
                    this.ripples.add(r.x, this.groundY, r.width * 3);
                }
                if (r.layer === 2 && Math.random() < 0.3) {
                    this.addSplash(r.x, this.groundY);
                }

                const layerData = this.layers[r.layer];
                Object.assign(r, this.createRaindrop(layerData, r.layer, false));
                r.y = -r.length;
            }
        });

        // 水花粒子
        this.splashParticles = this.splashParticles.filter(s => {
            s.x += s.vx * factor;
            s.y += s.vy * factor;
            s.vy += 0.15 * factor; // 重力
            s.life -= 0.04 * factor;
            return s.life > 0;
        });

        this.ripples.update(dt);
    }

    addSplash(x, y) {
        const count = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            const angle = -Math.PI * (0.2 + Math.random() * 0.6);
            const speed = 1 + Math.random() * 2;
            this.splashParticles.push({
                x, y,
                vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1),
                vy: Math.sin(angle) * speed,
                size: 0.8 + Math.random() * 1.2,
                life: 1
            });
        }
    }

    render() {
        const { isDark } = this.getThemeColors();
        const ctx = this.ctx;

        // 天空
        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        if (isDark) {
            grad.addColorStop(0, '#0c1830');
            grad.addColorStop(0.5, '#12243e');
            grad.addColorStop(1, '#1a2848');
        } else {
            grad.addColorStop(0, '#3a5a8a');
            grad.addColorStop(0.4, '#4a6e9e');
            grad.addColorStop(1, '#5a7a9a');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        // 地面湿润反光
        const groundGrad = ctx.createLinearGradient(0, this.groundY - 20, 0, this.h);
        groundGrad.addColorStop(0, 'transparent');
        groundGrad.addColorStop(0.3, isDark ? 'rgba(20, 40, 70, 0.3)' : 'rgba(50, 80, 120, 0.15)');
        groundGrad.addColorStop(1, isDark ? 'rgba(15, 30, 55, 0.5)' : 'rgba(40, 65, 100, 0.25)');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, this.groundY - 20, this.w, this.h - this.groundY + 20);

        // 雨滴
        ctx.lineCap = 'round';
        this.raindrops.forEach(r => {
            const windOff = this.windForce * (0.8 + r.layer * 0.15) * (r.length / r.speed) * 0.5;
            ctx.strokeStyle = isDark
                ? `rgba(150, 180, 220, ${r.opacity})`
                : `rgba(200, 220, 255, ${r.opacity})`;
            ctx.lineWidth = r.width;
            ctx.beginPath();
            ctx.moveTo(r.x, r.y);
            ctx.lineTo(r.x + windOff, r.y + r.length);
            ctx.stroke();
        });

        // 涟漪
        this.ripples.render(ctx, isDark);

        // 水花粒子
        this.splashParticles.forEach(s => {
            ctx.globalAlpha = s.life * 0.6;
            ctx.fillStyle = isDark ? 'rgba(160, 190, 230, 0.7)' : 'rgba(210, 230, 255, 0.8)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1;
    }
}

// ==================== 下雪场景 ====================
class SnowScene extends BaseScene {
    setup() {
        this.snowflakes = [];
        this.snowAccumulation = [];

        for (let i = 0; i < 120; i++) {
            this.snowflakes.push(this.createSnowflake());
        }

        const segments = 20;
        for (let i = 0; i <= segments; i++) {
            this.snowAccumulation.push({
                x: (i / segments) * this.w,
                baseY: this.h - Math.random() * 5,
                currentY: this.h - Math.random() * 5
            });
        }
    }

    createSnowflake() {
        return {
            x: Math.random() * this.w,
            y: Math.random() * this.h - this.h,
            radius: Math.random() * 3 + 1,
            speed: Math.random() * 1.5 + 0.5,
            amplitude: Math.random() * 40 + 20,
            phase: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.02 + 0.01,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.02,
            opacity: Math.random() * 0.5 + 0.4
        };
    }

    update(dt) {
        const factor = dt / 16.67;
        this.snowflakes.forEach(s => {
            s.y += s.speed * factor;
            s.phase += s.wobbleSpeed * factor;
            s.x += Math.sin(s.phase) * 0.5 * factor;
            s.rotation += s.rotationSpeed * factor;
            if (s.y > this.h + 10) {
                Object.assign(s, this.createSnowflake());
                s.y = -10;
            }
        });
    }

    render() {
        const { isDark } = this.getThemeColors();
        const ctx = this.ctx;

        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        if (isDark) {
            grad.addColorStop(0, '#0e1a30');
            grad.addColorStop(1, '#1a2e4a');
        } else {
            grad.addColorStop(0, '#4a6a8e');
            grad.addColorStop(1, '#7a9ab0');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        this.snowflakes.forEach(s => {
            ctx.save();
            ctx.translate(s.x, s.y);
            ctx.rotate(s.rotation);
            ctx.globalAlpha = s.opacity;
            ctx.fillStyle = isDark ? 'rgba(220, 230, 240, 0.8)' : '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, s.radius, 0, Math.PI * 2);
            ctx.fill();
            if (s.radius > 2.5) {
                ctx.strokeStyle = isDark ? 'rgba(200, 210, 220, 0.5)' : 'rgba(255, 255, 255, 0.6)';
                ctx.lineWidth = 0.5;
                for (let i = 0; i < 6; i++) {
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    const angle = (Math.PI / 3) * i;
                    ctx.lineTo(Math.cos(angle) * s.radius * 1.5, Math.sin(angle) * s.radius * 1.5);
                    ctx.stroke();
                }
            }
            ctx.restore();
        });

        // 积雪
        ctx.fillStyle = isDark ? 'rgba(200, 210, 220, 0.3)' : 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.moveTo(0, this.h);
        this.snowAccumulation.forEach((p, i) => {
            if (i === 0) ctx.lineTo(p.x, p.currentY);
            else {
                const prev = this.snowAccumulation[i - 1];
                const cpx = (prev.x + p.x) / 2;
                ctx.quadraticCurveTo(cpx, prev.currentY, p.x, p.currentY);
            }
        });
        ctx.lineTo(this.w, this.h);
        ctx.closePath();
        ctx.fill();
    }
}

// ==================== 雾/霾场景 ====================
class FogScene extends BaseScene {
    setup() {
        this.time = 0;
        this.fogLayers = [];
        for (let i = 0; i < 12; i++) {
            this.fogLayers.push({
                x: Math.random() * this.w * 2 - this.w * 0.5,
                y: Math.random() * this.h,
                width: Math.random() * 600 + 400,
                height: Math.random() * 200 + 100,
                speed: (Math.random() * 0.2 + 0.05) * (i % 2 === 0 ? 1 : -1),
                opacity: Math.random() * 0.08 + 0.04
            });
        }
    }

    update(dt) {
        this.time += dt;
        this.fogLayers.forEach(f => {
            f.x += f.speed * dt * 0.02;
            if (f.speed > 0 && f.x > this.w + f.width) f.x = -f.width;
            if (f.speed < 0 && f.x < -f.width) f.x = this.w + f.width;
        });
    }

    render() {
        const { isDark } = this.getThemeColors();
        const ctx = this.ctx;

        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        if (isDark) {
            grad.addColorStop(0, '#141e2e');
            grad.addColorStop(1, '#1e2e42');
        } else {
            grad.addColorStop(0, '#8aa0b4');
            grad.addColorStop(1, '#a0b8c8');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        this.fogLayers.forEach(f => {
            ctx.save();
            ctx.globalAlpha = f.opacity;
            ctx.fillStyle = isDark ? 'rgba(120, 140, 180, 0.3)' : 'rgba(180, 200, 230, 0.6)';
            ctx.beginPath();
            ctx.ellipse(f.x + f.width / 2, f.y + f.height / 2, f.width / 2, f.height / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });

        const edgeGrad = ctx.createLinearGradient(0, 0, 0, this.h * 0.3);
        edgeGrad.addColorStop(0, isDark ? 'rgba(20, 30, 46, 0.5)' : 'rgba(140, 160, 190, 0.3)');
        edgeGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = edgeGrad;
        ctx.fillRect(0, 0, this.w, this.h * 0.3);
    }
}

// ==================== 雷暴场景 ====================
class ThunderScene extends BaseScene {
    setup() {
        this.time = 0;
        this.ripples = new RippleSystem();
        this.raindrops = [];
        this.lightningTimer = 0;
        this.lightningInterval = 3000 + Math.random() * 5000;
        this.lightningFlash = 0;
        this.lightningBolts = [];
        this.windForce = 4;
        this.groundY = this.h - 4;

        for (let i = 0; i < 350; i++) {
            this.raindrops.push({
                x: Math.random() * (this.w + 200) - 100,
                y: Math.random() * this.h - this.h,
                speed: Math.random() * 6 + 15,
                length: Math.random() * 20 + 15,
                opacity: Math.random() * 0.3 + 0.3,
                width: Math.random() * 0.5 + 1.2
            });
        }
    }

    generateLightning() {
        const startX = Math.random() * this.w;
        const segments = 6 + Math.floor(Math.random() * 4);
        const dy = this.h / segments;
        const bolt = [];
        let x = startX, y = 0;
        for (let i = 0; i < segments; i++) {
            x += (Math.random() - 0.5) * 120;
            y += dy;
            bolt.push({ x, y });
            if (Math.random() < 0.3) {
                const branch = [];
                let bx = x, by = y;
                for (let j = 0; j < 3; j++) {
                    bx += (Math.random() - 0.5) * 60 + (Math.random() < 0.5 ? 20 : -20);
                    by += dy * 0.4;
                    branch.push({ x: bx, y: by });
                }
                bolt.push({ branch });
            }
        }
        this.lightningBolts.push({ points: bolt, life: 1 });
        this.lightningFlash = 0.8;
        if (this.foreground && this.foreground.triggerFlash) this.foreground.triggerFlash();
    }

    update(dt) {
        const factor = dt / 16.67;
        this.time += dt;

        this.raindrops.forEach(r => {
            r.y += r.speed * factor;
            r.x += this.windForce * factor;
            if (r.y > this.groundY) {
                if (Math.random() < 0.15) this.ripples.add(r.x, this.groundY, 2.5);
                r.y = -r.length;
                r.x = Math.random() * (this.w + 200) - 100;
            }
        });

        this.lightningTimer += dt;
        if (this.lightningTimer >= this.lightningInterval) {
            this.lightningTimer = 0;
            this.lightningInterval = 3000 + Math.random() * 5000;
            this.generateLightning();
        }

        this.lightningBolts = this.lightningBolts.filter(b => {
            b.life -= 0.04 * factor;
            return b.life > 0;
        });
        if (this.lightningFlash > 0) this.lightningFlash -= 0.05 * factor;

        this.ripples.update(dt);
    }

    render() {
        const ctx = this.ctx;

        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        grad.addColorStop(0, '#0a1018');
        grad.addColorStop(1, '#1a2530');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        if (this.lightningFlash > 0) {
            ctx.fillStyle = `rgba(200, 220, 255, ${this.lightningFlash * 0.15})`;
            ctx.fillRect(0, 0, this.w, this.h);
        }

        // 地面湿润
        const groundGrad = ctx.createLinearGradient(0, this.groundY - 15, 0, this.h);
        groundGrad.addColorStop(0, 'transparent');
        groundGrad.addColorStop(1, 'rgba(15, 25, 40, 0.4)');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, this.groundY - 15, this.w, this.h - this.groundY + 15);

        ctx.lineCap = 'round';
        this.raindrops.forEach(r => {
            const windOff = this.windForce * (r.length / r.speed) * 0.5;
            ctx.strokeStyle = `rgba(150, 180, 220, ${r.opacity})`;
            ctx.lineWidth = r.width;
            ctx.beginPath();
            ctx.moveTo(r.x, r.y);
            ctx.lineTo(r.x + windOff, r.y + r.length);
            ctx.stroke();
        });

        this.ripples.render(ctx, true);

        this.lightningBolts.forEach(bolt => {
            ctx.save();
            ctx.globalAlpha = bolt.life;
            ctx.strokeStyle = 'rgba(180, 200, 255, 0.3)';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            this.drawBoltPath(ctx, bolt.points);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(220, 235, 255, 0.9)';
            ctx.lineWidth = 2;
            this.drawBoltPath(ctx, bolt.points);
            ctx.stroke();
            ctx.restore();
        });
    }

    drawBoltPath(ctx, points) {
        ctx.beginPath();
        let first = true;
        points.forEach(p => {
            if (p.branch) {
                ctx.save();
                ctx.strokeStyle = 'rgba(200, 220, 255, 0.5)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                p.branch.forEach((bp, i) => {
                    if (i === 0) ctx.moveTo(bp.x, bp.y);
                    else ctx.lineTo(bp.x, bp.y);
                });
                ctx.stroke();
                ctx.restore();
            } else {
                if (first) { ctx.moveTo(p.x, p.y); first = false; }
                else ctx.lineTo(p.x, p.y);
            }
        });
    }
}

// ==================== 夜晚场景 ====================
class NightScene extends BaseScene {
    setup() {
        this.stars = [];
        this.meteorTimer = 0;
        this.meteorInterval = 20000 + Math.random() * 40000;
        this.meteors = [];

        for (let i = 0; i < 120; i++) {
            this.stars.push({
                x: Math.random() * this.w,
                y: Math.random() * this.h * 0.7,
                radius: Math.random() * 1.5 + 0.3,
                baseOpacity: Math.random() * 0.6 + 0.3,
                twinkleSpeed: Math.random() * 0.003 + 0.001,
                phase: Math.random() * Math.PI * 2
            });
        }
    }

    update(dt) {
        const factor = dt / 16.67;
        this.stars.forEach(s => { s.phase += s.twinkleSpeed * factor; });

        this.meteorTimer += dt;
        if (this.meteorTimer >= this.meteorInterval) {
            this.meteorTimer = 0;
            this.meteorInterval = 20000 + Math.random() * 40000;
            this.meteors.push({
                x: Math.random() * this.w * 0.8,
                y: 0,
                speed: 8 + Math.random() * 4,
                length: 80 + Math.random() * 60,
                angle: Math.PI / 4 + Math.random() * 0.3,
                life: 1
            });
        }

        this.meteors = this.meteors.filter(m => {
            m.x += Math.cos(m.angle) * m.speed * factor;
            m.y += Math.sin(m.angle) * m.speed * factor;
            m.life -= 0.008 * factor;
            return m.life > 0 && m.x < this.w && m.y < this.h;
        });
    }

    render() {
        const ctx = this.ctx;

        const grad = ctx.createLinearGradient(0, 0, 0, this.h);
        grad.addColorStop(0, '#0a0e1a');
        grad.addColorStop(0.5, '#0f1528');
        grad.addColorStop(1, '#1a2040');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.w, this.h);

        // 月亮
        const moonX = this.w * 0.8;
        const moonY = this.h * 0.15;
        const moonR = 40;

        const moonGlow = ctx.createRadialGradient(moonX, moonY, moonR * 0.5, moonX, moonY, moonR * 4);
        moonGlow.addColorStop(0, 'rgba(200, 220, 255, 0.1)');
        moonGlow.addColorStop(1, 'rgba(200, 220, 255, 0)');
        ctx.fillStyle = moonGlow;
        ctx.fillRect(0, 0, this.w, this.h);

        const moonGrad = ctx.createRadialGradient(moonX - 5, moonY - 5, 0, moonX, moonY, moonR);
        moonGrad.addColorStop(0, '#f0f0e0');
        moonGrad.addColorStop(0.7, '#e0e0d0');
        moonGrad.addColorStop(1, '#c0c0b0');
        ctx.beginPath();
        ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
        ctx.fillStyle = moonGrad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(moonX + 10, moonY - 5, moonR * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 21, 40, 0.3)';
        ctx.fill();

        // 星星
        this.stars.forEach(s => {
            const opacity = s.baseOpacity * (0.5 + 0.5 * Math.sin(s.phase));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 240, ${opacity})`;
            ctx.fill();
        });

        // 流星
        this.meteors.forEach(m => {
            ctx.save();
            ctx.globalAlpha = m.life;
            const endX = m.x - Math.cos(m.angle) * m.length;
            const endY = m.y - Math.sin(m.angle) * m.length;
            const meteorGrad = ctx.createLinearGradient(m.x, m.y, endX, endY);
            meteorGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
            meteorGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.strokeStyle = meteorGrad;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.restore();
        });
    }
}

// ==================== 前景基类 ====================
class BaseForeground {
    constructor(engine) {
        this.engine = engine;
        this.w = engine.w;
        this.h = engine.h;
        this.initialized = false;
    }
    init() { if (!this.initialized) { this.initialized = true; this.setup(); } }
    setup() {}
    update(dt) {}
    render(ctx) {}
    onThemeChange(theme) {}
    resize(w, h) { this.w = w; this.h = h; }
    getThemeColors() { return { isDark: this.engine.theme === 'dark' }; }
}

// ==================== 元素雨滴辅助 ====================
function setupCardDrops(maxDrops, maxDrips, dropInterval, dripSpeed) {
    return {
        cardDrops: [],
        cardDrips: [],
        cardDropTimer: 0,
        cardRects: [],
        cardRectTimer: 0,
        _maxDrops: maxDrops,
        _maxDrips: maxDrips,
        _dropInterval: dropInterval,
        _dripSpeed: dripSpeed
    };
}

// 收集页面上所有可见元素的位置
function collectVisibleRects(w, h) {
    const rects = [];
    const all = document.querySelectorAll('body *');
    for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const tag = el.tagName;
        if (tag === 'CANVAS' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'BR') continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 10) continue;
        if (r.bottom < 0 || r.top > h) continue;
        rects.push({ left: r.left, top: r.top, width: r.width });
    }
    return rects;
}

function updateCardDrops(cd, w, h, dt) {
    const factor = dt / 16.67;

    // 每 1.5 秒刷新一次元素位置
    cd.cardRectTimer += dt;
    if (cd.cardRectTimer > 1500) {
        cd.cardRectTimer = 0;
        cd.cardRects = collectVisibleRects(w, h);
    }

    // 在元素顶部生成水花
    cd.cardDropTimer += dt;
    const interval = cd._dropInterval;
    if (cd.cardRects.length > 0 && cd.cardDropTimer >= interval) {
        cd.cardDropTimer = 0;
        // 每次生成 1~2 个水花
        const count = Math.random() < 0.4 ? 2 : 1;
        for (let n = 0; n < count; n++) {
            const card = cd.cardRects[Math.floor(Math.random() * cd.cardRects.length)];
            const x = card.left + Math.random() * card.width;
            const y = card.top;
            // 冲击水珠
            cd.cardDrops.push({
                x, y,
                opacity: Math.random() * 0.35 + 0.25,
                life: 1,
                size: Math.random() * 3 + 2.5
            });
            // 溅起水滴 3~5 个
            const sc = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < sc; i++) {
                const angle = -Math.PI * (0.12 + Math.random() * 0.76);
                const spd = 1.2 + Math.random() * 2.2;
                cd.cardDrops.push({
                    x, y,
                    vx: Math.cos(angle) * spd * (Math.random() < 0.5 ? 1 : -1),
                    vy: Math.sin(angle) * spd,
                    opacity: Math.random() * 0.3 + 0.2,
                    life: 0.9 + Math.random() * 0.5,
                    size: 1 + Math.random() * 1.5,
                    splash: true
                });
            }
            // 水滴流下
            if (Math.random() < 0.75) {
                cd.cardDrips.push({
                    x: x + (Math.random() - 0.5) * 4,
                    y: y,
                    speed: Math.random() * 0.6 + cd._dripSpeed,
                    length: Math.random() * 45 + 20,
                    opacity: Math.random() * 0.3 + 0.12,
                    life: 1,
                    wobblePhase: Math.random() * Math.PI * 2,
                    wobbleSpeed: Math.random() * 0.04 + 0.02,
                    width: Math.random() * 0.8 + 1.2
                });
            }
        }
        if (cd.cardDrops.length > cd._maxDrops) cd.cardDrops.splice(0, cd.cardDrops.length - cd._maxDrops);
    }

    // 更新水花
    cd.cardDrops = cd.cardDrops.filter(d => {
        if (d.splash) {
            d.x += d.vx * factor;
            d.y += d.vy * factor;
            d.vy += 0.14 * factor;
        }
        d.life -= 0.03 * factor;
        return d.life > 0;
    });

    // 更新水流
    cd.cardDrips = cd.cardDrips.filter(d => {
        d.y += d.speed * factor;
        d.wobblePhase += d.wobbleSpeed * factor;
        d.life -= 0.008 * factor;
        d.opacity = d.life * 0.22;
        return d.life > 0 && d.y < h;
    });
}

function renderCardDrops(ctx, cd, isDark) {
    const dropColor = isDark ? '170, 210, 250' : '200, 225, 255';

    // 水花冲击点
    cd.cardDrops.forEach(d => {
        if (d.splash) {
            ctx.fillStyle = `rgba(${dropColor}, ${d.opacity * d.life})`;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // 冲击扩散圆
            const r = d.size * (2.8 - d.life * 1.5);
            ctx.strokeStyle = `rgba(${dropColor}, ${d.opacity * d.life * 0.6})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    });

    // 水流
    const dripColor = isDark ? '160, 200, 245' : '190, 220, 255';
    cd.cardDrips.forEach(d => {
        const wobbleX = Math.sin(d.wobblePhase) * 2.2;
        ctx.lineWidth = d.width || 1.4;
        ctx.strokeStyle = `rgba(${dripColor}, ${d.opacity})`;
        ctx.beginPath();
        ctx.moveTo(d.x + wobbleX, d.y);
        ctx.quadraticCurveTo(d.x + wobbleX * 1.4, d.y + d.length * 0.5, d.x + wobbleX * 0.4, d.y + d.length);
        ctx.stroke();
        // 水滴尾部圆点
        ctx.fillStyle = `rgba(${dripColor}, ${d.opacity * 1.3})`;
        ctx.beginPath();
        ctx.arc(d.x + wobbleX * 0.4, d.y + d.length, 2.2, 0, Math.PI * 2);
        ctx.fill();
    });
}

// ==================== 雨天前景 ====================
class RainForeground extends BaseForeground {
    setup() {
        this.drops = [];
        this.drips = [];
        this.dropTimer = 0;
        this.dropInterval = 60;

        for (let i = 0; i < 35; i++) {
            this.drops.push(this.createDrop());
        }

        this.cd = setupCardDrops(80, 50, 45, 0.35);
    }

    createDrop() {
        return {
            x: Math.random() * this.w,
            y: Math.random() * this.h * 0.3 - this.h * 0.3,
            speed: Math.random() * 6 + 10,
            length: Math.random() * 60 + 40,
            opacity: Math.random() * 0.2 + 0.1,
            landed: false
        };
    }

    createDrip(x, y) {
        return {
            x: x + (Math.random() - 0.5) * 4,
            y: y,
            speed: Math.random() * 0.6 + 0.3,
            length: Math.random() * 30 + 15,
            opacity: Math.random() * 0.25 + 0.1,
            life: 1,
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.04 + 0.02
        };
    }

    update(dt) {
        const factor = dt / 16.67;

        this.dropTimer += dt;
        if (this.dropTimer >= this.dropInterval) {
            this.dropTimer = 0;
            this.drops.push(this.createDrop());
            if (this.drops.length > 50) this.drops.shift();
        }

        this.drops.forEach(d => {
            if (d.landed) return;
            d.y += d.speed * factor;
            if (d.y > this.h * (0.3 + Math.random() * 0.6)) {
                d.landed = true;
                d.landY = d.y;
                d.landOpacity = d.opacity;
                d.landLife = 1;
                if (Math.random() < 0.4) this.drips.push(this.createDrip(d.x, d.y));
            }
        });

        this.drops = this.drops.filter(d => {
            if (!d.landed) return true;
            d.landLife -= 0.025 * factor;
            return d.landLife > 0;
        });

        this.drips = this.drips.filter(d => {
            d.y += d.speed * factor;
            d.wobblePhase += d.wobbleSpeed * factor;
            d.life -= 0.008 * factor;
            d.opacity = d.life * 0.2;
            return d.life > 0 && d.y < this.h;
        });

        updateCardDrops(this.cd, this.w, this.h, dt);
    }

    render(ctx) {
        const { isDark } = this.getThemeColors();
        const dropColor = isDark ? '170, 200, 240' : '200, 220, 255';
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';

        this.drops.forEach(d => {
            if (!d.landed) {
                ctx.strokeStyle = `rgba(${dropColor}, ${d.opacity})`;
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x + 1.5, d.y + d.length);
                ctx.stroke();
            } else {
                const markSize = 3 * (1 - d.landLife);
                ctx.fillStyle = `rgba(${dropColor}, ${d.landOpacity * d.landLife * 0.6})`;
                ctx.beginPath();
                ctx.arc(d.x, d.landY, markSize, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        const dripColor = isDark ? '160, 190, 230' : '190, 215, 250';
        ctx.lineWidth = 1;
        this.drips.forEach(d => {
            const wobbleX = Math.sin(d.wobblePhase) * 2;
            ctx.strokeStyle = `rgba(${dripColor}, ${d.opacity})`;
            ctx.beginPath();
            ctx.moveTo(d.x + wobbleX, d.y);
            ctx.quadraticCurveTo(d.x + wobbleX * 1.5, d.y + d.length * 0.5, d.x + wobbleX * 0.5, d.y + d.length);
            ctx.stroke();
            ctx.fillStyle = `rgba(${dripColor}, ${d.opacity * 1.2})`;
            ctx.beginPath();
            ctx.arc(d.x + wobbleX * 0.5, d.y + d.length, 2, 0, Math.PI * 2);
            ctx.fill();
        });

        renderCardDrops(ctx, this.cd, isDark);
    }
}

// ==================== 雪天前景 ====================
class SnowForeground extends BaseForeground {
    setup() {
        this.flakes = [];
        for (let i = 0; i < 40; i++) this.flakes.push(this.createFlake());
    }

    createFlake() {
        return {
            x: Math.random() * this.w,
            y: Math.random() * this.h - this.h,
            radius: Math.random() * 4 + 2,
            speed: Math.random() * 1.2 + 0.3,
            amplitude: Math.random() * 30 + 15,
            phase: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.015 + 0.005,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.015,
            opacity: Math.random() * 0.35 + 0.15
        };
    }

    update(dt) {
        const factor = dt / 16.67;
        this.flakes.forEach(f => {
            f.y += f.speed * factor;
            f.phase += f.wobbleSpeed * factor;
            f.x += Math.sin(f.phase) * 0.4 * factor;
            f.rotation += f.rotationSpeed * factor;
            if (f.y > this.h + 20) { Object.assign(f, this.createFlake()); f.y = -20; }
        });
    }

    render(ctx) {
        const { isDark } = this.getThemeColors();
        this.flakes.forEach(f => {
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.rotation);
            ctx.globalAlpha = f.opacity;
            ctx.fillStyle = isDark ? 'rgba(220, 230, 245, 0.9)' : '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, f.radius, 0, Math.PI * 2);
            ctx.fill();
            if (f.radius > 3.5) {
                ctx.strokeStyle = isDark ? 'rgba(200, 215, 230, 0.5)' : 'rgba(255, 255, 255, 0.5)';
                ctx.lineWidth = 0.5;
                for (let i = 0; i < 6; i++) {
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    const angle = (Math.PI / 3) * i;
                    ctx.lineTo(Math.cos(angle) * f.radius * 1.8, Math.sin(angle) * f.radius * 1.8);
                    ctx.stroke();
                }
            }
            ctx.restore();
        });
        ctx.globalAlpha = 1;
    }
}

// ==================== 雷暴前景 ====================
class ThunderForeground extends BaseForeground {
    setup() {
        this.drops = [];
        this.drips = [];
        this.flashOpacity = 0;
        this.dropTimer = 0;
        for (let i = 0; i < 50; i++) this.drops.push(this.createDrop());

        this.cd = setupCardDrops(100, 60, 30, 0.45);
    }

    createDrop() {
        return {
            x: Math.random() * this.w,
            y: Math.random() * this.h * 0.4 - this.h * 0.4,
            speed: Math.random() * 8 + 14,
            length: Math.random() * 70 + 50,
            opacity: Math.random() * 0.25 + 0.15,
            landed: false
        };
    }

    createDrip(x, y) {
        return {
            x: x + (Math.random() - 0.5) * 4,
            y: y,
            speed: Math.random() * 0.8 + 0.4,
            length: Math.random() * 35 + 20,
            opacity: Math.random() * 0.3 + 0.15,
            life: 1,
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleSpeed: Math.random() * 0.05 + 0.025
        };
    }

    update(dt) {
        const factor = dt / 16.67;
        this.dropTimer += dt;
        if (this.dropTimer >= 40) {
            this.dropTimer = 0;
            this.drops.push(this.createDrop());
            if (this.drops.length > 65) this.drops.shift();
        }

        this.drops.forEach(d => {
            if (d.landed) return;
            d.y += d.speed * factor;
            if (d.y > this.h * (0.2 + Math.random() * 0.6)) {
                d.landed = true;
                d.landY = d.y;
                d.landOpacity = d.opacity;
                d.landLife = 1;
                if (Math.random() < 0.5) this.drips.push(this.createDrip(d.x, d.y));
            }
        });

        this.drops = this.drops.filter(d => {
            if (!d.landed) return true;
            d.landLife -= 0.035 * factor;
            return d.landLife > 0;
        });

        this.drips = this.drips.filter(d => {
            d.y += d.speed * factor;
            d.wobblePhase += d.wobbleSpeed * factor;
            d.life -= 0.01 * factor;
            d.opacity = d.life * 0.25;
            return d.life > 0 && d.y < this.h;
        });

        if (this.flashOpacity > 0) this.flashOpacity -= 0.06 * factor;

        updateCardDrops(this.cd, this.w, this.h, dt);
    }

    triggerFlash() { this.flashOpacity = 0.6; }

    render(ctx) {
        const { isDark } = this.getThemeColors();

        if (this.flashOpacity > 0) {
            ctx.fillStyle = `rgba(200, 220, 255, ${this.flashOpacity * 0.12})`;
            ctx.fillRect(0, 0, this.w, this.h);
        }

        const dropColor = isDark ? '160, 190, 230' : '190, 215, 250';
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';

        this.drops.forEach(d => {
            if (!d.landed) {
                ctx.strokeStyle = `rgba(${dropColor}, ${d.opacity})`;
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x + 2, d.y + d.length);
                ctx.stroke();
            } else {
                const markSize = 4 * (1 - d.landLife);
                ctx.fillStyle = `rgba(${dropColor}, ${d.landOpacity * d.landLife * 0.5})`;
                ctx.beginPath();
                ctx.arc(d.x, d.landY, markSize, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        const dripColor = isDark ? '150, 180, 220' : '180, 210, 245';
        ctx.lineWidth = 1.2;
        this.drips.forEach(d => {
            const wobbleX = Math.sin(d.wobblePhase) * 2.5;
            ctx.strokeStyle = `rgba(${dripColor}, ${d.opacity})`;
            ctx.beginPath();
            ctx.moveTo(d.x + wobbleX, d.y);
            ctx.quadraticCurveTo(d.x + wobbleX * 1.8, d.y + d.length * 0.5, d.x + wobbleX * 0.3, d.y + d.length);
            ctx.stroke();
            ctx.fillStyle = `rgba(${dripColor}, ${d.opacity * 1.3})`;
            ctx.beginPath();
            ctx.arc(d.x + wobbleX * 0.3, d.y + d.length, 2.5, 0, Math.PI * 2);
            ctx.fill();
        });

        renderCardDrops(ctx, this.cd, isDark);
    }
}

// ==================== 雾天前景 ====================
class FogForeground extends BaseForeground {
    setup() {
        this.particles = [];
        for (let i = 0; i < 8; i++) {
            this.particles.push({
                x: Math.random() * this.w * 2 - this.w * 0.5,
                y: Math.random() * this.h,
                width: Math.random() * 500 + 300,
                height: Math.random() * 150 + 80,
                speed: (Math.random() * 0.15 + 0.05) * (Math.random() < 0.5 ? 1 : -1),
                opacity: Math.random() * 0.04 + 0.02
            });
        }
    }

    update(dt) {
        this.particles.forEach(p => {
            p.x += p.speed * dt * 0.02;
            if (p.speed > 0 && p.x > this.w + p.width) p.x = -p.width;
            if (p.speed < 0 && p.x < -p.width) p.x = this.w + p.width;
        });
    }

    render(ctx) {
        const { isDark } = this.getThemeColors();
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = isDark ? 'rgba(120, 140, 180, 0.3)' : 'rgba(180, 200, 230, 0.5)';
            ctx.beginPath();
            ctx.ellipse(p.x + p.width / 2, p.y + p.height / 2, p.width / 2, p.height / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }
}

// ==================== 夜晚前景 ====================
class NightForeground extends BaseForeground {
    setup() {
        this.particles = [];
        for (let i = 0; i < 15; i++) {
            this.particles.push({
                x: Math.random() * this.w,
                y: Math.random() * this.h,
                size: Math.random() * 1.5 + 0.5,
                speed: Math.random() * 0.15 + 0.05,
                opacity: Math.random() * 0.15 + 0.05,
                phase: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.003 + 0.001
            });
        }
    }

    update(dt) {
        const factor = dt / 16.67;
        this.particles.forEach(p => {
            p.phase += p.twinkleSpeed * factor;
            p.y -= p.speed * factor * 0.2;
            if (p.y < -10) { p.y = this.h + 10; p.x = Math.random() * this.w; }
        });
    }

    render(ctx) {
        this.particles.forEach(p => {
            const opacity = p.opacity * (0.5 + 0.5 * Math.sin(p.phase));
            ctx.fillStyle = `rgba(255, 255, 240, ${opacity})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });
    }
}

// 导出
window.WeatherAnimationEngine = WeatherAnimationEngine;
