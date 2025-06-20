This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Dependencies Graph Viewer with AI Analysis

一個強大的依賴圖檢視器，整合 AI 雙重分析功能：

- 📄 **檔案依賴圖**：視覺化專案檔案之間的依賴關係
- 🐳 **Docker 功能圖**：使用 LangChain.js 檢測並視覺化 Docker API 使用情況
- 🧠 **AI 摘要**：自動生成檔案功能摘要
- 🔍 **智能搜尋**：快速定位特定檔案

## 環境變數配置

創建 `.env.local` 檔案並設定以下變數：

```bash
# API 配置
# 開發環境 (後端 API 端口)
NEXT_PUBLIC_API_URL=http://localhost:3031

# 生產環境 (修改為您的實際 API URL)
# NEXT_PUBLIC_API_URL=https://your-api-domain.com
# NEXT_PUBLIC_API_PORT=3031

# OpenAI API Key (後端需要)
OPENAI_API_KEY=your-openai-api-key-here

# GitHub Token (可選，用於存取私有倉庫)
GITHUB_TOKEN=your-github-token-here
```

## Getting Started

1. **安裝依賴**：

```bash
npm install
```

2. **設定環境變數**：
   複製並編輯 `.env.local` 檔案，填入您的 API keys

3. **啟動前端開發伺服器**：

```bash
npm run dev
```

4. **啟動後端 AI 分析服務**：

```bash
# 設定 API Key 並啟動
OPENAI_API_KEY="your-api-key" node summarize-server.mjs
```

5. **開啟瀏覽器**：
   前往 [http://localhost:3030](http://localhost:3030) (前端)
   後端 API 服務運行在 [http://localhost:3031](http://localhost:3031)

## 功能特色

### 🔄 雙視圖切換

- **檔案依賴圖**：顯示檔案間的 import/export 關係
- **Docker 功能圖**：顯示檔案與 Docker 功能的連線關係

### 🤖 AI 雙重分析

- **檔案摘要**：生成繁體中文的檔案功能描述
- **Docker 檢測**：使用 LangChain.js 結構化分析 Docker API 使用

### 🎨 視覺化特性

- **自動布局**：使用 dagre 演算法自動排版
- **分類著色**：不同類型檔案使用不同顏色標示
- **連線強度**：根據使用頻率顯示不同粗細的連線
- **互動功能**：點擊節點查看詳細資訊

### 🔍 搜尋與篩選

- **模糊搜尋**：支援檔案名稱和路徑搜尋
- **類型篩選**：可依檔案類型過濾顯示
- **即時高亮**：搜尋結果即時高亮顯示

## 部署配置

### 開發環境

系統會自動使用 `localhost:3031` 作為 API 端點

### 生產環境

1. 設定 `NEXT_PUBLIC_API_URL` 環境變數
2. 部署後端 API 服務
3. 確保 CORS 設定正確

### Docker 部署

```dockerfile
# 範例 Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3031
CMD ["npm", "start"]
```

## API 端點

- `GET /api/summaries` - 獲取所有檔案摘要
- `GET /api/docker-analysis` - 獲取 Docker 分析結果
- `GET /api/docker-graph` - 獲取 Docker 功能圖資料
- `GET /api/dual-analysis` - 執行雙重分析
- `GET /api/analysis-stats` - 獲取分析統計

## 技術架構

- **前端**：Next.js, React Flow, TailwindCSS
- **後端**：Node.js, Express
- **AI 整合**：OpenAI GPT-4, LangChain.js
- **視覺化**：ReactFlow, dagre
- **搜尋**：Fuse.js

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
