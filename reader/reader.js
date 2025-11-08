// 数据库初始化
const DB_NAME = "epubReaderDB";
const DB_VERSION = 1;
const BOOK_STORE = "books";
let db;
let book;
let rendition;
let currentBookId;

// 初始化应用
async function init() {
    try {
        await initDB();

        // 从URL获取书籍ID
        const urlParams = new URLSearchParams(window.location.search);
        currentBookId = urlParams.get("id");

        if (!currentBookId) {
            showError("未找到书籍ID");
            return;
        }

        // 加载书籍
        const bookData = await getBookById(currentBookId);
        if (!bookData) {
            showError("未找到书籍数据");
            return;
        }

        // 显示书籍标题
        document.getElementById("bookTitle").textContent = bookData.title;
        document.title = `阅读 - ${bookData.title}`;

        // 初始化EPUB阅读器
        await initReader(bookData);

        // 设置事件监听器
        setupEventListeners();

        // 优先从localStorage加载阅读位置，如果没有则使用IndexedDB中的位置
        const localPosition = localStorage.getItem(
            `epub_position_${currentBookId}`,
        );

        console.log(localPosition, 1111);
        if (localPosition) {
            rendition.display(localPosition);
        } else if (bookData.lastReadPosition) {
            rendition.display(bookData.lastReadPosition);
        }
    } catch (error) {
        console.error("初始化失败:", error);
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
async function initReader(bookData) {
    // 创建EPUB书籍对象
    book = ePub();
    book.open(bookData.fileData);

    // 创建渲染器
    const bookContent = document.getElementById("bookContent");
    rendition = book.renderTo(bookContent, {
        width: "100%",
        height: "100%",
        spread: "none",
    });

    // 显示书籍内容
    await rendition.display();

    // 加载保存的配置
    loadSavedSettings();

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

    // 设置翻页事件
    let initialLocationSet = false;
    rendition.on("relocated", (location) => {
        const progress = book.locations.percentageFromCfi(location.start.cfi);
        const percentage = Math.round(progress * 100);
        document.getElementById(
            "currentLocation",
        ).textContent = `${percentage}%`;

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

    // 生成位置信息
    await book.locations.generate(1000);
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

    // 添加键盘左右方向键翻页功能
    document.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") {
            rendition.prev();
        }
        if (e.key === "ArrowRight") {
            rendition.next();
        }
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

    // 键盘控制
    document.addEventListener("keydown", (e) => {
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
