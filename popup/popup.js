// 数据库初始化
const DB_NAME = 'epubReaderDB';
const DB_VERSION = 1;
const BOOK_STORE = 'books';
let db;

// 初始化IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = (event) => {
      console.error('数据库打开失败:', event.target.error);
      reject(event.target.error);
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('数据库连接成功');
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BOOK_STORE)) {
        const store = db.createObjectStore(BOOK_STORE, { keyPath: 'id' });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('author', 'author', { unique: false });
        console.log('书籍存储对象创建成功');
      }
    };
  });
}

// 保存书籍到IndexedDB
async function saveBook(book) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOK_STORE], 'readwrite');
    const store = transaction.objectStore(BOOK_STORE);
    const request = store.add(book);
    
    request.onsuccess = () => {
      console.log('书籍保存成功');
      resolve(request.result);
    };
    
    request.onerror = (event) => {
      console.error('保存书籍失败:', event.target.error);
      reject(event.target.error);
    };
  });
}

// 获取所有书籍
async function getAllBooks() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOK_STORE], 'readonly');
    const store = transaction.objectStore(BOOK_STORE);
    const request = store.getAll();
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onerror = (event) => {
      console.error('获取书籍失败:', event.target.error);
      reject(event.target.error);
    };
  });
}

// 删除书籍
async function deleteBook(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([BOOK_STORE], 'readwrite');
    const store = transaction.objectStore(BOOK_STORE);
    const request = store.delete(id);
    
    request.onsuccess = () => {
      console.log('书籍删除成功');
      resolve();
    };
    
    request.onerror = (event) => {
      console.error('删除书籍失败:', event.target.error);
      reject(event.target.error);
    };
  });
}

// 处理文件上传
async function handleFileUpload(file) {
  if (file.type !== 'application/epub+zip') {
    alert('请上传EPUB格式的文件');
    return;
  }
  
  try {
    // 读取文件内容
    const arrayBuffer = await readFileAsArrayBuffer(file);
    
    // 使用EPUB.js解析电子书
    const book = ePub(arrayBuffer);
    await book.ready;
    
    // 获取元数据
    const metadata = await book.loaded.metadata;
    const coverUrl = await getCoverUrl(book);
    
    // 创建书籍对象
    const bookData = {
      id: generateUUID(),
      title: metadata.title,
      author: metadata.creator,
      coverUrl: coverUrl,
      fileData: arrayBuffer,
      addedDate: new Date().toISOString(),
      lastReadPosition: 0
    };
    
    // 保存到数据库
    await saveBook(bookData);
    
    // 更新书籍列表
    await loadBooks();
    
  } catch (error) {
    console.error('处理文件上传失败:', error);
    alert('处理文件失败，请重试');
  }
}

// 获取封面图片URL
async function getCoverUrl(book) {
  try {
    const cover = await book.loaded.cover;
    if (cover) {
      const coverUrl = await book.archive.createUrl(cover, { base64: true });
      return coverUrl;
    }
    return null;
  } catch (error) {
    console.error('获取封面失败:', error);
    return null;
  }
}

// 将文件读取为ArrayBuffer
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

// 生成UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 加载并显示书籍列表
async function loadBooks() {
  try {
    const books = await getAllBooks();
    const bookList = document.getElementById('bookList');
    bookList.innerHTML = '';
    
    if (books.length === 0) {
      bookList.innerHTML = '<p class="no-books">没有找到书籍，请上传EPUB文件</p>';
      return;
    }
    
    books.forEach(book => {
      const bookElement = createBookElement(book);
      bookList.appendChild(bookElement);
    });
  } catch (error) {
    console.error('加载书籍失败:', error);
  }
}

// 创建书籍元素
function createBookElement(book) {
  const bookItem = document.createElement('div');
  bookItem.className = 'book-item';
  bookItem.dataset.id = book.id;
  
  const coverImg = document.createElement('img');
  coverImg.className = 'book-cover';
  coverImg.src = book.coverUrl || '../icons/default-cover.svg';
  coverImg.alt = book.title;
  
  const bookInfo = document.createElement('div');
  bookInfo.className = 'book-info';
  
  const titleElement = document.createElement('div');
  titleElement.className = 'book-title';
  titleElement.textContent = book.title;
  
  const authorElement = document.createElement('div');
  authorElement.className = 'book-author';
  authorElement.textContent = book.author || '未知作者';
  
  const bookActions = document.createElement('div');
  bookActions.className = 'book-actions';
  
  const readButton = document.createElement('button');
  readButton.className = 'book-action';
  readButton.innerHTML = '📖';
  readButton.title = '阅读';
  readButton.addEventListener('click', (e) => {
    e.stopPropagation();
    openReader(book.id);
  });
  
  const deleteButton = document.createElement('button');
  deleteButton.className = 'book-action';
  deleteButton.innerHTML = '🗑️';
  deleteButton.title = '删除';
  deleteButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`确定要删除《${book.title}》吗？`)) {
      await deleteBook(book.id);
      loadBooks();
    }
  });
  
  bookInfo.appendChild(titleElement);
  bookInfo.appendChild(authorElement);
  bookActions.appendChild(readButton);
  bookActions.appendChild(deleteButton);
  
  bookItem.appendChild(coverImg);
  bookItem.appendChild(bookInfo);
  bookItem.appendChild(bookActions);
  
  bookItem.addEventListener('click', () => {
    openReader(book.id);
  });
  
  return bookItem;
}

// 打开阅读器
function openReader(bookId) {
  chrome.tabs.create({
    url: chrome.runtime.getURL(`reader/reader.html?id=${bookId}`)
  });
}

// 搜索功能
function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', async () => {
    const query = searchInput.value.toLowerCase();
    const books = await getAllBooks();
    const filteredBooks = books.filter(book => 
      book.title.toLowerCase().includes(query) || 
      (book.author && book.author.toLowerCase().includes(query))
    );
    
    const bookList = document.getElementById('bookList');
    bookList.innerHTML = '';
    
    if (filteredBooks.length === 0) {
      bookList.innerHTML = '<p class="no-books">没有找到匹配的书籍</p>';
      return;
    }
    
    filteredBooks.forEach(book => {
      const bookElement = createBookElement(book);
      bookList.appendChild(bookElement);
    });
  });
}

// 设置文件上传
function setupDragAndDrop() {
  const fileInput = document.getElementById('fileInput');
  const uploadButton = document.querySelector('.upload-button');
  
  // 处理文件选择
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
      // 重置文件输入框，确保可以重复选择同一文件
      fileInput.value = '';
    }
  });
  
  // 点击"选择文件"按钮时打开文件选择器
  uploadButton.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput.click();
  });
}

// 初始化应用
async function init() {
  try {
    await initDB();
    await loadBooks();
    setupSearch();
    setupDragAndDrop();
  } catch (error) {
    console.error('初始化失败:', error);
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);