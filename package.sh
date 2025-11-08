#!/bin/bash
# EPUB Reader 打包脚本
# 用途：将项目打包成 ZIP 压缩包，排除不必要的文件

# 获取项目目录
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# 生成时间戳（格式：YYYYMMDD_HHMMSS）
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 输出文件名
OUTPUT_FILE="epubReader_${TIMESTAMP}.zip"

echo "开始打包 EPUB Reader..."
echo "项目目录: $PROJECT_DIR"
echo "输出文件: $OUTPUT_FILE"
echo ""

# 打包命令
# 排除以下文件和目录：
# - .git/*          Git 版本控制文件
# - .DS_Store       macOS 系统文件
# - *.zip           已存在的压缩包
# - node_modules/*  Node.js 依赖（如果有）
# - *.log           日志文件
# - *.swp, *.swo, *~  编辑器临时文件
# - package.sh      打包脚本本身
zip -r "$OUTPUT_FILE" . \
  -x "*.git/*" \
  -x "*.DS_Store" \
  -x "*.zip" \
  -x "*node_modules/*" \
  -x "*.log" \
  -x "*.swp" \
  -x "*.swo" \
  -x "*~" \
  -x "package.sh" \
  > /dev/null 2>&1

# 检查打包是否成功
if [ $? -eq 0 ]; then
    # 获取文件大小
    FILE_SIZE=$(ls -lh "$OUTPUT_FILE" | awk '{print $5}')
    echo "✅ 打包完成！"
    echo "📦 文件: $OUTPUT_FILE"
    echo "📊 大小: $FILE_SIZE"
    echo "📍 位置: $PROJECT_DIR/$OUTPUT_FILE"
else
    echo "❌ 打包失败！请检查错误信息。"
    exit 1
fi

