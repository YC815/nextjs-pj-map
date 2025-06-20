# 檔案分析處理器

這是一個獨立的 Python 工具，用於分析程式碼檔案並生成摘要與 Docker 關係分析。

## 功能特色

- 📁 讀取 `cytoscape-elements.json` 中的檔案清單
- 🌐 從 GitHub 自動獲取檔案內容
- 🤖 使用 GPT-4o 進行智能分析
- 🐳 Docker 整合關係分析
- 📊 結構化輸出（使用 Langchain）
- 🛑 支援中斷處理（Ctrl+C）
- 📈 實時進度條顯示
- 💾 自動緩存機制

## 安裝依賴

```bash
pip install -r requirements.txt
```

## 環境配置

創建 `.env` 檔案並設定以下環境變數：

```bash
# OpenAI API 密鑰（必需）
OPENAI_API_KEY=your_openai_api_key_here

# GitHub 倉庫（可選，預設為 YC815/ai-web-ide）
GITHUB_REPO=YC815/ai-web-ide
```

**注意：** 由於使用公開倉庫，不需要 GitHub Token。

## 使用方法

### 基本使用

```bash
python analysis_processor.py
```

### 使用環境變數

```bash
export OPENAI_API_KEY="your-api-key"
export GITHUB_REPO="YC815/ai-web-ide"  # 可選，已設為預設值
python analysis_processor.py
```

## 輸出結果

工具會在 `.cache` 目錄中生成以下檔案：

- `combined-analysis.json`: 完整的分析結果
- `summaries.json`: 檔案摘要（向後相容）
- `docker-analysis.json`: Docker 分析結果（向後相容）

### 分析結果結構

```json
{
  "file-path": {
    "hasDockerIntegration": true,
    "dockerApis": [
      {
        "apiType": "api",
        "description": "Docker API 描述",
        "line": 42,
        "codeSnippet": "相關程式碼片段"
      }
    ],
    "dockerTools": ["docker-compose", "dockerfile"],
    "summary": "檔案功能摘要",
    "fileType": "component",
    "keyFunctions": ["主要功能1", "主要功能2"]
  }
}
```

## 特色功能

### 1. 中斷處理

按下 `Ctrl+C` 可以安全中斷處理過程，已處理的資料會自動保存。

### 2. 進度追蹤

實時顯示處理進度：

```
分析進度: 45%|████▌     | 45/100 files [02:30<03:45, 0.30files/s]
```

### 3. 緩存機制

- 自動跳過已分析的檔案
- 每處理 5 個檔案自動保存
- 支援斷點續傳

### 4. 統計資訊

完成後顯示詳細統計：

```
📊 分析統計:
   總檔案數: 100
   Docker 整合檔案: 25
   Docker 整合比例: 25.0%

📋 檔案類型分佈:
   component: 30
   api: 20
   utility: 15
   ...
```

## 錯誤處理

- GitHub API：使用 Raw API 優先，速度更快且無需認證
- OpenAI API 限制：工具會自動加入延遲避免超限
- 網路問題：自動重試機制
- 檔案過大：自動截取前 8000 字元避免 token 限制

## 注意事項

1. 確保 `public/cytoscape-elements.json` 檔案存在
2. OpenAI API Key 需要有足夠的配額
3. 公開倉庫使用 Raw API，速度快且穩定
4. 大型專案建議分批處理，避免一次性處理過多檔案

## 故障排除

### 常見問題

**Q: "找不到 cytoscape-elements.json 檔案"**
A: 確保檔案位於 `public/cytoscape-elements.json`

**Q: "OpenAI API 錯誤"**
A: 檢查 API Key 是否有效且有足夠配額

**Q: "GitHub 檔案獲取失敗"**
A: 檢查網路連線，工具會自動嘗試多種 API

**Q: "處理速度太慢"**
A: 這是正常的，AI 分析需要時間，可使用 Ctrl+C 中斷並稍後續傳

# 檔案分析處理器使用說明

## 功能簡介

這個腳本能夠讀取 `cytoscape-elements.json` 檔案，從 GitHub 倉庫獲取檔案內容，並使用 OpenAI API 進行摘要和 Docker 關係分析。

## 新功能特色

### 🔄 雙模式支援

- **網路模式**：直接從 GitHub 獲取檔案（預設）
- **本地克隆模式**：將倉庫克隆到本地再讀取檔案（更穩定）

### 🌿 智慧分支檢測

- 自動嘗試 `main` 和 `master` 分支
- 支援自定義分支名稱

### 🛠️ 增強的錯誤處理

- 詳細的錯誤訊息和調試資訊
- 自動重試機制
- 優雅的中斷處理

## 環境變數配置

### 必需設定

```bash
export OPENAI_API_KEY="your-openai-api-key"
```

### 可選設定

```bash
# GitHub 倉庫 (格式: owner/repo)
export GITHUB_REPO="YC815/ai-web-ide"

# GitHub Token (私有倉庫或提高 API 限制)
export GITHUB_TOKEN="your-github-token"

# 分支名稱
export GITHUB_BRANCH="main"

# 使用本地克隆模式
export USE_LOCAL_CLONE="true"
```

## 使用方式

### 方法一：網路模式（預設）

```bash
# 使用預設設定
python analysis_processor.py

# 或指定倉庫
GITHUB_REPO="your-username/your-repo" python analysis_processor.py
```

### 方法二：本地克隆模式（推薦）

```bash
# 啟用本地克隆模式，更穩定
USE_LOCAL_CLONE=true python analysis_processor.py

# 完整設定範例
export GITHUB_REPO="your-username/your-repo"
export GITHUB_BRANCH="main"
export USE_LOCAL_CLONE="true"
export OPENAI_API_KEY="your-openai-api-key"
python analysis_processor.py
```

## 問題排除

### 檔案不存在錯誤

如果出現 "檔案不存在" 錯誤，請檢查：

1. **倉庫名稱**：確認 `GITHUB_REPO` 格式為 `owner/repo`
2. **分支名稱**：確認檔案在指定分支上
3. **檔案路徑**：確認 `cytoscape-elements.json` 中的路徑與 GitHub 實際結構一致

### 建議的調試步驟

```bash
# 1. 檢查倉庫是否存在
curl -s -I "https://github.com/your-username/your-repo" | head -1

# 2. 檢查特定檔案是否存在
curl -s -I "https://raw.githubusercontent.com/your-username/your-repo/main/path/to/file" | head -1

# 3. 使用本地克隆模式（最穩定）
USE_LOCAL_CLONE=true GITHUB_REPO="your-username/your-repo" python analysis_processor.py
```

### API 限制問題

如果遇到 GitHub API 限制：

- 設定 `GITHUB_TOKEN` 提高限制
- 或使用 `USE_LOCAL_CLONE=true` 避開 API 限制

## 輸出檔案

腳本會在 `.cache/` 目錄下生成：

- `combined-analysis.json`：完整的分析結果
- `summaries.json`：檔案摘要（向後兼容）
- `docker-analysis.json`：Docker 分析結果（向後兼容）

## 實時更新機制

### 自動更新 cytoscape-elements.json

您可以設定 cron job 或 GitHub Actions 來定期更新：

```bash
# 每小時檢查更新
0 * * * * cd /path/to/your/project && curl -s -o public/cytoscape-elements.json "https://raw.githubusercontent.com/your-source-repo/main/public/cytoscape-elements.json" && USE_LOCAL_CLONE=true python analysis_processor.py
```

### GitHub Actions 範例

```yaml
name: Update Analysis
on:
  schedule:
    - cron: "0 */6 * * *" # 每6小時執行一次
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Update cytoscape-elements.json
        run: |
          curl -s -o public/cytoscape-elements.json "https://raw.githubusercontent.com/source-repo/main/public/cytoscape-elements.json"
      - name: Run analysis
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          USE_LOCAL_CLONE: "true"
        run: python analysis_processor.py
```

## 效能最佳化

### 本地克隆模式優勢

- 避免 GitHub API 限制
- 更快的檔案存取速度
- 更穩定的連線
- 支援大量檔案處理

### 快取機制

- 已分析的檔案會被快取
- 只分析新增或修改的檔案
- 可手動刪除 `.cache/` 目錄重新分析

## 常見問題

**Q: 為什麼建議使用本地克隆模式？**
A: 本地克隆模式避開了 GitHub API 限制，提供更穩定的檔案存取，特別適合大量檔案的分析處理。

**Q: 如何更新倉庫內容？**
A: 每次執行時，本地克隆模式會自動刪除舊的克隆並重新克隆最新內容。

**Q: 可以分析私有倉庫嗎？**
A: 可以，請設定 `GITHUB_TOKEN` 環境變數並確保 token 有相應權限。
