// summarize-server.js
import fs from "fs";
import path from "path";
import express from "express";
import { OpenAI } from "openai";
import cors from "cors";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "langchain/prompts";
import { z } from "zod";
import { StructuredOutputParser } from "langchain/output_parsers";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const chatModel = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: "gpt-4o",
  temperature: 0,
});

const app = express();
const port = 3031;

// 啟用 CORS
app.use(cors());

// GitHub 設定
const GITHUB_REPO = "YC815/ai-web-ide";
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

// 從 GitHub 獲取檔案內容
async function fetchGitHubFile(filePath) {
  try {
    // 嘗試使用 GitHub Raw API（不需要認證，更快）
    const rawUrl = `${GITHUB_RAW_BASE}/${GITHUB_REPO}/main/${filePath}`;
    const response = await fetch(rawUrl);

    if (response.ok) {
      const content = await response.text();
      console.log(`📥 從 GitHub Raw 獲取檔案：${filePath}`);
      return content;
    }

    // 如果 Raw API 失敗，嘗試使用 GitHub API
    const apiUrl = `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/contents/${filePath}`;
    const apiResponse = await fetch(apiUrl, {
      headers: process.env.GITHUB_TOKEN
        ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
        : {},
    });

    if (apiResponse.ok) {
      const data = await apiResponse.json();
      if (data.content) {
        const content = Buffer.from(data.content, "base64").toString("utf8");
        console.log(`📥 從 GitHub API 獲取檔案：${filePath}`);
        return content;
      }
    }

    throw new Error(
      `無法從 GitHub 獲取檔案：${response.status} / ${apiResponse.status}`
    );
  } catch (error) {
    console.error(`❌ GitHub 檔案獲取失敗：${filePath}`, error.message);
    throw error;
  }
}

const summariesPath = path.join("public", "code-summaries.json");
const dockerAnalysisPath = path.join("public", "docker-analysis.json");

let summaries = fs.existsSync(summariesPath)
  ? JSON.parse(fs.readFileSync(summariesPath, "utf8"))
  : {};

let dockerAnalysis = fs.existsSync(dockerAnalysisPath)
  ? JSON.parse(fs.readFileSync(dockerAnalysisPath, "utf8"))
  : {};

// Docker 分析結構化輸出定義 - 專為圖形連線設計
const dockerAnalysisSchema = z.object({
  hasDockerIntegration: z
    .boolean()
    .describe("是否使用了 Docker API 或相關技術"),
  dockerNodes: z
    .array(
      z.object({
        id: z
          .string()
          .describe(
            "Docker 功能節點的唯一 ID (如: docker-container-mgmt, docker-image-build 等)"
          ),
        name: z
          .string()
          .describe(
            "Docker 功能名稱 (如: Container Management, Image Building 等)"
          ),
        type: z
          .enum(["api", "tool", "service", "config"])
          .describe("Docker 功能類型"),
        description: z.string().describe("該 Docker 功能的詳細描述"),
        codeSnippet: z.string().optional().describe("相關的程式碼片段"),
        line: z.number().optional().describe("程式碼行號"),
      })
    )
    .describe("檔案中使用的 Docker 功能節點列表"),
  dockerConnections: z
    .array(
      z.object({
        source: z.string().describe("來源節點 ID (檔案路徑)"),
        target: z.string().describe("目標 Docker 功能節點 ID"),
        relationship: z
          .string()
          .describe("連線關係類型 (如: uses, configures, manages 等)"),
        strength: z
          .number()
          .min(1)
          .max(3)
          .describe("連線強度 (1=輕度使用, 2=中度使用, 3=核心功能)"),
      })
    )
    .describe("檔案與 Docker 功能之間的連線關係"),
  dockerTools: z.array(z.string()).describe("使用的 Docker 相關工具或套件"),
  summary: z.string().describe("Docker 整合的整體摘要"),
});

const dockerOutputParser =
  StructuredOutputParser.fromZodSchema(dockerAnalysisSchema);

// Docker 檢測提示模板 - 專為圖形連線設計
const dockerPromptTemplate = PromptTemplate.fromTemplate(`
請仔細分析以下程式檔案，檢測 Docker 相關功能並建立圖形連線資料：

檔案位置：{filePath}
檔案內容：
{content}

分析重點：
1. 檢測所有 Docker 相關功能，為每個功能創建節點
2. 建立該檔案與各 Docker 功能之間的連線關係
3. 評估每個連線的強度和關係類型

Docker 功能節點範例：
- docker-container-create (容器創建)
- docker-container-start (容器啟動)
- docker-image-build (映像檔建置)
- docker-compose-up (Docker Compose 啟動)
- docker-network-create (網路創建)
- docker-volume-mount (資料卷掛載)

連線關係類型：
- uses: 使用該功能
- configures: 配置該功能
- manages: 管理該功能
- depends: 依賴該功能

請為檔案路徑 "{filePath}" 分析並建立 Docker 功能圖：
{format_instructions}
`);

// 建立 Docker 分析鏈
const dockerAnalysisChain = dockerPromptTemplate
  .pipe(chatModel)
  .pipe(dockerOutputParser);

app.get("/api/summarize", async (req, res) => {
  const file = req.query.file;
  const source = req.query.source || "local"; // local, github

  if (!file) return res.status(400).send("Missing file");

  // 建立快取鍵（包含來源）
  const cacheKey = source === "github" ? `github:${file}` : file;

  // 如果已有快取，直接回傳
  if (summaries[cacheKey]) {
    console.log(`📋 使用快取摘要：${cacheKey}`);
    return res.json({
      summary: summaries[cacheKey],
      cached: true,
      source: source === "github" ? "GitHub" : "本地",
    });
  }

  let content;
  let fileDisplayName = file;

  try {
    if (source === "github") {
      // 從 GitHub 獲取檔案
      content = await fetchGitHubFile(file);
      fileDisplayName = `GitHub: ${GITHUB_REPO}/${file}`;
    } else {
      // 從本地檔案系統獲取
      const filePath = path.join("src", file);
      if (!fs.existsSync(filePath)) {
        console.log(`❌ 本地檔案不存在：${filePath}，嘗試從 GitHub 獲取...`);
        // 本地不存在時自動嘗試 GitHub
        try {
          content = await fetchGitHubFile(file);
          fileDisplayName = `GitHub: ${GITHUB_REPO}/${file}`;
          console.log(`✅ 自動從 GitHub 獲取檔案：${file}`);
        } catch {
          return res.status(404).send("File not found in local or GitHub");
        }
      } else {
        content = fs.readFileSync(filePath, "utf8");
        fileDisplayName = `本地: ${file}`;
      }
    }

    const prompt = `請幫我用繁體中文簡要摘要以下程式檔案的用途與結構，用一段文字描述給開發者參考：

檔案位置：${fileDisplayName}

檔案內容：
${content}`;

    console.log(`🧠 正在產生摘要：${fileDisplayName}`);
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });

    const summary = completion.choices[0].message.content.trim();
    summaries[cacheKey] = summary;

    // 持久化存儲
    fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2));
    console.log(`✅ 產出摘要：${fileDisplayName}`);
    res.json({
      summary,
      cached: false,
      source: source === "github" ? "GitHub" : "本地",
      filePath: fileDisplayName,
    });
  } catch (err) {
    console.error(`❌ 處理錯誤：`, err);
    if (err.message.includes("GitHub")) {
      res.status(404).send("GitHub file not found or API error");
    } else {
      res.status(500).send("Error processing file or OpenAI");
    }
  }
});

// 雙重分析端點（摘要 + Docker 檢測）
app.get("/api/dual-analysis", async (req, res) => {
  const file = req.query.file;
  const source = req.query.source || "github";

  if (!file) return res.status(400).send("Missing file");

  const summaryKey = source === "github" ? `github:${file}` : file;
  const dockerKey = source === "github" ? `github:${file}` : file;

  try {
    let content;
    let fileDisplayName = file;

    // 獲取檔案內容
    if (source === "github") {
      content = await fetchGitHubFile(file);
      fileDisplayName = `GitHub: ${GITHUB_REPO}/${file}`;
    } else {
      const filePath = path.join("src", file);
      if (!fs.existsSync(filePath)) {
        try {
          content = await fetchGitHubFile(file);
          fileDisplayName = `GitHub: ${GITHUB_REPO}/${file}`;
        } catch {
          return res.status(404).send("File not found in local or GitHub");
        }
      } else {
        content = fs.readFileSync(filePath, "utf8");
        fileDisplayName = `本地: ${file}`;
      }
    }

    const results = {
      summary: null,
      dockerAnalysis: null,
      cached: {
        summary: false,
        docker: false,
      },
    };

    // 第一次分析：摘要
    if (summaries[summaryKey]) {
      results.summary = summaries[summaryKey];
      results.cached.summary = true;
      console.log(`📋 使用快取摘要：${summaryKey}`);
    } else {
      console.log(`🧠 正在產生摘要：${fileDisplayName}`);
      const summaryPrompt = `請幫我用繁體中文簡要摘要以下程式檔案的用途與結構，用一段文字描述給開發者參考：

檔案位置：${fileDisplayName}

檔案內容：
${content}`;

      const summaryCompletion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: summaryPrompt }],
      });

      results.summary = summaryCompletion.choices[0].message.content.trim();
      summaries[summaryKey] = results.summary;
      fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2));
    }

    // 第二次分析：Docker 檢測
    if (dockerAnalysis[dockerKey]) {
      results.dockerAnalysis = dockerAnalysis[dockerKey];
      results.cached.docker = true;
      console.log(`🐳 使用快取 Docker 分析：${dockerKey}`);
    } else {
      console.log(`🐳 正在進行 Docker 分析：${fileDisplayName}`);
      try {
        const dockerResult = await dockerAnalysisChain.invoke({
          filePath: fileDisplayName,
          content: content,
          format_instructions: dockerOutputParser.getFormatInstructions(),
        });

        results.dockerAnalysis = dockerResult;
        dockerAnalysis[dockerKey] = dockerResult;
        fs.writeFileSync(
          dockerAnalysisPath,
          JSON.stringify(dockerAnalysis, null, 2)
        );
      } catch (dockerError) {
        console.error(`❌ Docker 分析失敗：${fileDisplayName}`, dockerError);
        results.dockerAnalysis = {
          hasDockerIntegration: false,
          dockerApis: [],
          dockerTools: [],
          summary: "Docker 分析失敗",
        };
      }
    }

    console.log(`✅ 雙重分析完成：${fileDisplayName}`);
    res.json({
      ...results,
      source: source === "github" ? "GitHub" : "本地",
      filePath: fileDisplayName,
    });
  } catch (err) {
    console.error(`❌ 雙重分析錯誤：`, err);
    res.status(500).send("Error in dual analysis");
  }
});

// 取得所有快取的摘要
app.get("/api/summaries", (req, res) => {
  res.json(summaries);
});

// 取得所有 Docker 分析結果
app.get("/api/docker-analysis", (req, res) => {
  res.json(dockerAnalysis);
});

// 生成 Docker 圖形資料
app.get("/api/docker-graph", async (req, res) => {
  try {
    const dockerNodes = new Map();
    const dockerEdges = [];
    const fileNodes = [];

    // 遍歷所有 Docker 分析結果
    for (const [fileKey, analysis] of Object.entries(dockerAnalysis)) {
      if (analysis.hasDockerIntegration && analysis.dockerNodes) {
        // 添加檔案節點
        const fileName = fileKey.replace("github:", "");
        fileNodes.push({
          id: fileKey,
          data: {
            label: `📄 ${fileName.split("/").pop()}`,
            fullPath: fileName,
            type: "file",
          },
          position: { x: 0, y: 0 },
          style: {
            background: "#f3f4f6",
            color: "#374151",
            border: "2px solid #d1d5db",
          },
        });

        // 添加 Docker 功能節點
        analysis.dockerNodes.forEach((dockerNode) => {
          if (!dockerNodes.has(dockerNode.id)) {
            const nodeColor =
              {
                api: "#3b82f6", // 藍色 - API
                tool: "#10b981", // 綠色 - 工具
                service: "#8b5cf6", // 紫色 - 服務
                config: "#f59e0b", // 橙色 - 配置
              }[dockerNode.type] || "#6b7280";

            dockerNodes.set(dockerNode.id, {
              id: dockerNode.id,
              data: {
                label: `🐳 ${dockerNode.name}`,
                type: "docker",
                dockerType: dockerNode.type,
                description: dockerNode.description,
              },
              position: { x: 0, y: 0 },
              style: {
                background: nodeColor,
                color: "#ffffff",
                border: "2px solid rgba(255,255,255,0.3)",
                borderRadius: "12px",
                fontSize: "12px",
                fontWeight: "bold",
              },
            });
          }
        });

        // 添加連線
        analysis.dockerConnections.forEach((connection) => {
          const edgeColor =
            {
              1: "#94a3b8", // 輕度使用 - 灰色
              2: "#3b82f6", // 中度使用 - 藍色
              3: "#dc2626", // 核心功能 - 紅色
            }[connection.strength] || "#94a3b8";

          dockerEdges.push({
            id: `${connection.source}->${connection.target}`,
            source: connection.source,
            target: connection.target,
            data: {
              relationship: connection.relationship,
              strength: connection.strength,
            },
            style: {
              stroke: edgeColor,
              strokeWidth: connection.strength * 2,
            },
            label: connection.relationship,
            animated: connection.strength >= 2,
          });
        });
      }
    }

    // 使用 dagre 自動布局
    const allNodes = [...fileNodes, ...Array.from(dockerNodes.values())];
    const layoutedResult = getLayoutedDockerElements(allNodes, dockerEdges);

    res.json({
      nodes: layoutedResult.nodes,
      edges: layoutedResult.edges,
      stats: {
        totalFiles: fileNodes.length,
        totalDockerNodes: dockerNodes.size,
        totalConnections: dockerEdges.length,
        dockerTypes: {
          api: Array.from(dockerNodes.values()).filter(
            (n) => n.data.dockerType === "api"
          ).length,
          tool: Array.from(dockerNodes.values()).filter(
            (n) => n.data.dockerType === "tool"
          ).length,
          service: Array.from(dockerNodes.values()).filter(
            (n) => n.data.dockerType === "service"
          ).length,
          config: Array.from(dockerNodes.values()).filter(
            (n) => n.data.dockerType === "config"
          ).length,
        },
      },
    });
  } catch (err) {
    console.error("❌ Docker 圖形生成失敗:", err);
    res.status(500).send("Error generating Docker graph");
  }
});

// Docker 圖形布局函數
function getLayoutedDockerElements(nodes, edges) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 100 });

  const nodeWidth = 180;
  const nodeHeight = 60;

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const pos = dagreGraph.node(node.id);
    return {
      ...node,
      position: { x: pos.x - nodeWidth / 2, y: pos.y - nodeHeight / 2 },
      style: {
        ...node.style,
        width: nodeWidth,
        height: nodeHeight,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// 取得所有雙重分析的統計
app.get("/api/analysis-stats", (req, res) => {
  const summaryCount = Object.keys(summaries).length;
  const dockerCount = Object.keys(dockerAnalysis).length;
  const dockerWithIntegration = Object.values(dockerAnalysis).filter(
    (analysis) => analysis.hasDockerIntegration
  ).length;

  res.json({
    totalSummaries: summaryCount,
    totalDockerAnalysis: dockerCount,
    dockerIntegrationCount: dockerWithIntegration,
    dockerIntegrationFiles: Object.entries(dockerAnalysis)
      .filter(([, analysis]) => analysis.hasDockerIntegration)
      .map(([file, analysis]) => ({
        file,
        dockerTools: analysis.dockerTools,
        apiCount: analysis.dockerApis.length,
      })),
  });
});

// 清除特定檔案的快取
app.delete("/api/summarize", (req, res) => {
  const file = req.query.file;
  const source = req.query.source || "local";

  if (!file) return res.status(400).send("Missing file");

  const cacheKey = source === "github" ? `github:${file}` : file;

  if (summaries[cacheKey]) {
    delete summaries[cacheKey];
    fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2));
    console.log(`🗑️ 清除快取：${cacheKey}`);
    res.json({ message: "Cache cleared", key: cacheKey });
  } else {
    res.status(404).send("Summary not found");
  }
});

app.listen(port, () => {
  console.log(`🧠 Summarize server listening on http://localhost:${port}`);
});
