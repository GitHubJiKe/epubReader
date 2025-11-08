// 数据库初始化
const DB_NAME = "epubReaderDB";
const DB_VERSION = 1;
const BOOK_STORE = "books";
let db;
let book;
let rendition;
let currentBookId;

// 显示加载中
function showLoading() {
    const loadingOverlay = document.getElementById("loadingOverlay");
    if (loadingOverlay) {
        loadingOverlay.style.display = "flex";
        loadingOverlay.classList.remove("hidden");
        loadingOverlay.style.opacity = "1";
    }
}

// 隐藏加载中
function hideLoading() {
    const loadingOverlay = document.getElementById("loadingOverlay");
    if (loadingOverlay) {
        loadingOverlay.classList.add("hidden");
        // 等待动画完成后隐藏元素
        setTimeout(() => {
            loadingOverlay.style.display = "none";
        }, 300);
    }
}

// 初始化应用
async function init() {
    try {
        // 显示加载状态
        showLoading();

        await initDB();

        // 从URL获取书籍ID
        const urlParams = new URLSearchParams(window.location.search);
        currentBookId = urlParams.get("id");

        if (!currentBookId) {
            hideLoading();
            showError("未找到书籍ID");
            return;
        }

        // 加载书籍
        const bookData = await getBookById(currentBookId);
        if (!bookData) {
            hideLoading();
            showError("未找到书籍数据");
            return;
        }

        // 显示书籍标题
        document.getElementById("bookTitle").textContent = bookData.title;
        document.title = `阅读 - ${bookData.title}`;

        // 获取保存的阅读位置（在初始化之前获取，避免重复显示）
        const localPosition = localStorage.getItem(
            `epub_position_${currentBookId}`,
        );
        const savedPosition = localPosition || bookData.lastReadPosition;

        // 初始化EPUB阅读器（先显示内容，locations在后台生成）
        await initReader(bookData, savedPosition);

        // 设置事件监听器
        setupEventListeners();

        // 隐藏加载状态（内容已显示，locations在后台继续生成）
        hideLoading();
    } catch (error) {
        console.error("初始化失败:", error);
        hideLoading();
        showError("初始化阅读器失败");
    }
}

// 初始化IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("数据库打开失败:", event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log("数据库连接成功");
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(BOOK_STORE)) {
                const store = db.createObjectStore(BOOK_STORE, {
                    keyPath: "id",
                });
                store.createIndex("title", "title", { unique: false });
                store.createIndex("author", "author", { unique: false });
                console.log("书籍存储对象创建成功");
            }
        };
    });
}

// 根据ID获取书籍
async function getBookById(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([BOOK_STORE], "readonly");
        const store = transaction.objectStore(BOOK_STORE);
        const request = store.get(id);

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onerror = (event) => {
            console.error("获取书籍失败:", event.target.error);
            reject(event.target.error);
        };
    });
}

// 更新阅读进度显示（显示页码）
function updateReadingProgress(location) {
    const currentLocationElement = document.getElementById("currentLocation");
    if (!currentLocationElement) return;

    // 优先使用页码显示（如果可用）
    if (location && location.start && location.start.displayed) {
        const currentPage = location.start.displayed.page;
        const totalPages = location.start.displayed.total;
        
        if (currentPage !== undefined && totalPages !== undefined) {
            // 显示页码：当前页 / 总页数
            currentLocationElement.textContent = `${currentPage} / ${totalPages}`;
            return;
        }
    }

    // 如果页码不可用，回退到百分比显示
    if (book.locations && typeof book.locations.percentageFromCfi === "function") {
        try {
            const progress = book.locations.percentageFromCfi(location.start.cfi);
            const percentage = Math.round(progress * 100);
            currentLocationElement.textContent = `${percentage}%`;
        } catch (e) {
            // 如果位置信息还未生成或计算失败，显示"计算中..."提示
            if (currentLocationElement.textContent !== "计算中..." && 
                !currentLocationElement.textContent.includes("/")) {
                currentLocationElement.textContent = "计算中...";
            }
        }
    } else {
        // locations还未生成，显示"计算中..."提示
        if (currentLocationElement.textContent !== "计算中..." && 
            !currentLocationElement.textContent.includes("/")) {
            currentLocationElement.textContent = "计算中...";
        }
    }
}

// 更新书籍阅读位置
async function updateReadingPosition(id, position) {
    // 注意：localStorage的存储已经在relocated事件中直接处理
    // 这里只更新IndexedDB中的数据
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([BOOK_STORE], "readwrite");
        const store = transaction.objectStore(BOOK_STORE);
        const request = store.get(id);

        request.onsuccess = () => {
            const data = request.result;
            if (data) {
                data.lastReadPosition = position;
                const updateRequest = store.put(data);

                updateRequest.onsuccess = () => {
                    resolve();
                };

                updateRequest.onerror = (event) => {
                    reject(event.target.error);
                };
            } else {
                reject(new Error("未找到书籍"));
            }
        };

        request.onerror = (event) => {
            reject(event.target.error);
        };
    });
}

// 初始化EPUB阅读器
async function initReader(bookData, savedPosition = null) {
    try {
        // 创建EPUB书籍对象
        book = ePub(bookData.fileData);
        
        // 等待书籍加载完成
        await book.ready;

        // 创建渲染器
        const bookContent = document.getElementById("bookContent");
        rendition = book.renderTo(bookContent, {
            width: "100%",
            height: "100%",
            spread: "none",
        });

        // 设置翻页事件监听器
        let initialLocationSet = false;
        rendition.on("relocated", (location) => {
            // 更新阅读进度
            updateReadingProgress(location);

            // 只有在用户主动翻页或初始化完成后才保存位置
            if (initialLocationSet) {
                // 直接在localStorage中保存阅读位置，确保数据立即持久化
                localStorage.setItem(
                    `epub_position_${currentBookId}`,
                    location.start.cfi,
                );

                // 同时更新IndexedDB中的数据
                updateReadingPosition(currentBookId, location.start.cfi);
            } else {
                // 标记初始化已完成
                initialLocationSet = true;
            }
        });

        // 显示内容（如果有保存位置就显示保存位置，否则显示第一页）
        // 让用户立即看到内容，不等待locations生成
        if (savedPosition) {
            await rendition.display(savedPosition);
        } else {
            await rendition.display();
        }

        // 并行处理：加载目录和配置（不阻塞显示）
        const loadTocAndSettings = async () => {
            // 加载目录
            const toc = await book.loaded.navigation;
            const tocContent = document.getElementById("tocContent");
            
            if (toc && toc.toc && toc.toc.length > 0) {
                toc.toc.forEach((item) => {
                    const tocItem = document.createElement("div");
                    tocItem.className = "toc-item";
                    tocItem.textContent = item.label;
                    tocItem.addEventListener("click", () => {
                        rendition.display(item.href);
                        toggleToc();
                    });
                    tocContent.appendChild(tocItem);
                });
            } else {
                tocContent.innerHTML = "<p>无可用目录</p>";
            }
            
            // 加载保存的配置
            loadSavedSettings();
        };

        // 异步加载目录和配置（不阻塞主流程）
        loadTocAndSettings().catch(err => {
            console.warn("加载目录或配置失败:", err);
        });

        // 后台异步生成位置信息（不阻塞内容显示）
        // 使用更大的间隔值(5000)以减少生成时间，虽然精度稍低但速度更快
        generateLocationsInBackground(5000);
    } catch (error) {
        console.error("初始化阅读器失败:", error);
        throw error;
    }
}

// 在后台生成位置信息
async function generateLocationsInBackground(interval = 5000) {
    try {
        // 显示"计算中..."提示
        const currentLocationElement = document.getElementById("currentLocation");
        if (currentLocationElement && !currentLocationElement.textContent.includes("/")) {
            currentLocationElement.textContent = "计算中...";
        }

        // 生成位置信息（使用更大的间隔以提高速度）
        await book.locations.generate(interval);
        
        // locations生成后，更新当前进度显示
        try {
            const currentLocation = rendition.currentLocation();
            if (currentLocation) {
                updateReadingProgress(currentLocation);
            }
        } catch (err) {
            console.warn("获取当前位置失败:", err);
        }
    } catch (err) {
        console.warn("位置信息生成失败:", err);
        // 如果生成失败，尝试使用当前位置的页码信息
        try {
            const currentLocation = rendition.currentLocation();
            if (currentLocation) {
                updateReadingProgress(currentLocation);
            }
        } catch (e) {
            const currentLocationElement = document.getElementById("currentLocation");
            if (currentLocationElement) {
                currentLocationElement.textContent = "-";
            }
        }
    }
}

// 设置事件监听器
function setupEventListeners() {
    // 目录切换
    document.getElementById("toggleToc").addEventListener("click", toggleToc);
    document.getElementById("closeToc").addEventListener("click", toggleToc);

    // 翻页控制
    document.getElementById("prevPage").addEventListener("click", () => {
        rendition.prev();
    });

    document.getElementById("nextPage").addEventListener("click", () => {
        rendition.next();
    });

    // 字体大小调整
    document
        .getElementById("fontSizeIncrease")
        .addEventListener("click", () => {
            changeFontSize(1);
        });

    document
        .getElementById("fontSizeDecrease")
        .addEventListener("click", () => {
            changeFontSize(-1);
        });

    // 主题切换
    document
        .getElementById("toggleTheme")
        .addEventListener("click", toggleTheme);

    // 键盘控制（左右方向键翻页）
    document.addEventListener("keydown", (e) => {
        // 避免在输入框中触发翻页
        if (
            e.target.tagName === "INPUT" ||
            e.target.tagName === "TEXTAREA" ||
            e.target.isContentEditable
        ) {
            return;
        }

        switch (e.key) {
            case "ArrowLeft":
                rendition.prev();
                break;
            case "ArrowRight":
                rendition.next();
                break;
        }
    });
}

// 切换目录显示
function toggleToc() {
    const toc = document.getElementById("toc");
    toc.classList.toggle("active");
}

// 更改字体大小
function changeFontSize(delta) {
    const root = document.documentElement;
    const currentSize = parseInt(
        getComputedStyle(root).getPropertyValue("--font-size"),
    );
    const newSize = Math.max(12, Math.min(24, currentSize + delta));

    root.style.setProperty("--font-size", `${newSize}px`);

    // 更新阅读器内容的字体大小
    rendition.themes.fontSize(`${newSize}px`);

    // 保存字体大小设置到localStorage
    localStorage.setItem(`epub_font_size_${currentBookId}`, newSize);
}

// 切换主题
function toggleTheme() {
    const body = document.body;
    const themeButton = document.getElementById("toggleTheme");
    const isDarkTheme = body.classList.contains("dark-theme");

    if (isDarkTheme) {
        body.classList.remove("dark-theme");
        themeButton.textContent = "☀️";
        rendition.themes.override("color", "#333");
        rendition.themes.override("background", "#fff");
        // 保存主题设置到localStorage
        localStorage.setItem(`epub_theme_${currentBookId}`, "light");
    } else {
        body.classList.add("dark-theme");
        themeButton.textContent = "🌙";
        rendition.themes.override("color", "#eee");
        rendition.themes.override("background", "#222");
        // 保存主题设置到localStorage
        localStorage.setItem(`epub_theme_${currentBookId}`, "dark");
    }
}

// 加载保存的设置
function loadSavedSettings() {
    // 加载字体大小设置
    const savedFontSize = localStorage.getItem(
        `epub_font_size_${currentBookId}`,
    );
    if (savedFontSize) {
        const fontSize = parseInt(savedFontSize);
        document.documentElement.style.setProperty(
            "--font-size",
            `${fontSize}px`,
        );
        rendition.themes.fontSize(`${fontSize}px`);
    }

    // 加载主题设置
    const savedTheme = localStorage.getItem(`epub_theme_${currentBookId}`);
    if (savedTheme === "dark") {
        document.body.classList.add("dark-theme");
        document.getElementById("toggleTheme").textContent = "🌙";
        rendition.themes.override("color", "#eee");
        rendition.themes.override("background", "#222");
    }
}

// 显示错误信息
function showError(message) {
    const bookContent = document.getElementById("bookContent");
    bookContent.innerHTML = `<div class="error-message">${message}</div>`;
}

// 启动应用
document.addEventListener("DOMContentLoaded", init);
