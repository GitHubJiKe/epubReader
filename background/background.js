// 背景脚本 - 处理缓存和性能优化

// 缓存配置
const CACHE_VERSION = 1;
const CACHE_NAME = `epub-reader-cache-v${CACHE_VERSION}`;
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB 缓存上限

// 初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('EPUB Reader 扩展已安装');
  
  // 清理旧缓存
  cleanupCache();
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'processEpub') {
    // 处理大文件上传 - 分块处理
    processEpubFile(message.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 异步响应
  }
  
  if (message.action === 'cacheResource') {
    // 缓存资源
    cacheResource(message.url, message.data)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 异步响应
  }
  
  if (message.action === 'getCachedResource') {
    // 获取缓存资源
    getCachedResource(message.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 异步响应
  }
});

// 分块处理EPUB文件
async function processEpubFile(fileData) {
  // 文件大小超过5MB时进行分块处理
  const CHUNK_SIZE = 1024 * 1024; // 1MB 块大小
  
  if (fileData.byteLength > 5 * CHUNK_SIZE) {
    console.log('文件较大，进行分块处理');
    
    // 创建一个工作线程来处理大文件
    return new Promise((resolve, reject) => {
      const chunks = Math.ceil(fileData.byteLength / CHUNK_SIZE);
      let processedChunks = 0;
      let result = new Uint8Array(fileData.byteLength);
      
      for (let i = 0; i < chunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileData.byteLength);
        const chunk = fileData.slice(start, end);
        
        // 模拟异步处理每个块
        setTimeout(() => {
          // 将处理后的块复制到结果数组
          result.set(new Uint8Array(chunk), start);
          
          processedChunks++;
          if (processedChunks === chunks) {
            resolve(result.buffer);
          }
        }, 0);
      }
    });
  }
  
  // 小文件直接返回
  return fileData;
}

// 缓存资源
async function cacheResource(url, data) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = new Response(data);
    await cache.put(url, response);
    
    // 更新缓存使用情况
    await updateCacheUsage(url, data.byteLength);
    
    return true;
  } catch (error) {
    console.error('缓存资源失败:', error);
    throw error;
  }
}

// 获取缓存资源
async function getCachedResource(url) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    
    if (response) {
      // 更新资源的最后访问时间
      await updateResourceAccessTime(url);
      return await response.arrayBuffer();
    }
    
    throw new Error('资源未缓存');
  } catch (error) {
    console.error('获取缓存资源失败:', error);
    throw error;
  }
}

// 清理缓存
async function cleanupCache() {
  try {
    // 获取缓存使用情况
    const cacheUsage = await getCacheUsage();
    
    // 如果缓存大小超过限制，删除最旧的资源
    if (cacheUsage.totalSize > MAX_CACHE_SIZE) {
      // 按最后访问时间排序
      const resources = Object.entries(cacheUsage.resources)
        .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
      
      const cache = await caches.open(CACHE_NAME);
      
      // 删除旧资源直到缓存大小低于限制
      let currentSize = cacheUsage.totalSize;
      for (const [url, info] of resources) {
        if (currentSize <= MAX_CACHE_SIZE * 0.8) { // 删除到80%阈值
          break;
        }
        
        await cache.delete(url);
        currentSize -= info.size;
        
        // 更新缓存使用记录
        await removeFromCacheUsage(url);
      }
    }
  } catch (error) {
    console.error('清理缓存失败:', error);
  }
}

// 缓存使用情况管理
async function getCacheUsage() {
  return new Promise((resolve) => {
    chrome.storage.local.get('cacheUsage', (result) => {
      const cacheUsage = result.cacheUsage || { totalSize: 0, resources: {} };
      resolve(cacheUsage);
    });
  });
}

async function updateCacheUsage(url, size) {
  const cacheUsage = await getCacheUsage();
  
  // 更新或添加资源信息
  cacheUsage.resources[url] = {
    size: size,
    lastAccessed: Date.now()
  };
  
  // 重新计算总大小
  cacheUsage.totalSize = Object.values(cacheUsage.resources)
    .reduce((total, info) => total + info.size, 0);
  
  // 保存更新后的缓存使用情况
  chrome.storage.local.set({ cacheUsage });
}

async function updateResourceAccessTime(url) {
  const cacheUsage = await getCacheUsage();
  
  if (cacheUsage.resources[url]) {
    cacheUsage.resources[url].lastAccessed = Date.now();
    chrome.storage.local.set({ cacheUsage });
  }
}

async function removeFromCacheUsage(url) {
  const cacheUsage = await getCacheUsage();
  
  if (cacheUsage.resources[url]) {
    const size = cacheUsage.resources[url].size;
    delete cacheUsage.resources[url];
    cacheUsage.totalSize -= size;
    chrome.storage.local.set({ cacheUsage });
  }
}