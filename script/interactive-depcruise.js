import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { cruise } from "dependency-cruiser";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const askQuestions = async () => {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "targetDir",
      message: "你想分析哪個目錄？",
      default: "./src",
    },
    {
      type: "confirm",
      name: "initConfig",
      message: "需要建立預設的 .dependency-cruiser.js 設定檔嗎？",
      default: true,
    },
    {
      type: "input",
      name: "jsonOutput",
      message: "要輸出的 JSON 檔名為？",
      default: "dependency-graph.json",
    },
    {
      type: "confirm",
      name: "generateCytoscape",
      message: "是否要生成前端兼容的 Cytoscape 格式檔案？",
      default: true,
    },
    {
      type: "confirm",
      name: "generateDot",
      message: "是否要同時輸出 DOT 格式檔案？",
      default: false,
    },
    {
      type: "confirm",
      name: "generateSvg",
      message: "是否要輸出 SVG 圖形檔？",
      default: false,
    },
  ]);

  return answers;
};

const createDefaultConfig = (configPath) => {
  const defaultConfig = `module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: '不允許循環依賴',
      from: {},
      to: {
        circular: true
      }
    },
    {
      name: 'no-orphans',
      severity: 'info',
      comment: '檢查孤立模組',
      from: {
        orphan: true,
        pathNot: [
          '\\.(d\\.ts|spec|test)$',
          'index\\.[jt]sx?$'
        ]
      },
      to: {}
    }
  ],
  options: {
    // 忽略的路徑
    doNotFollow: {
      path: 'node_modules'
    },
    // 排除的檔案
    exclude: {
      path: [
        'node_modules',
        '\\.spec\\.[jt]sx?$',
        '\\.test\\.[jt]sx?$',
        '__tests__',
        '__mocks__'
      ]
    },
    // TypeScript 相關設定
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    preserveSymlinks: false,
    
    // 檔案類型過濾
    moduleSystems: ['amd', 'cjs', 'es6', 'tsd'],
    
    // 輸出設定
    outputType: 'json',
    
    // 報告選項
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/[^/]+',
        filters: {
          includeOnly: {
            path: '^src'
          }
        }
      }
    }
  }
};`;

  fs.writeFileSync(configPath, defaultConfig);
  console.log(`✔ 已建立預設設定檔 ${path.basename(configPath)}`);
};

const generateDotFile = async (jsonData, outputPath) => {
  try {
    // 使用 dependency-cruiser 的 dot reporter
    const dotContent = `digraph "dependency-graph" {
  rankdir=LR;
  node [shape=box style=filled fillcolor=lightblue];
  
${jsonData.modules
  .map((module) => {
    const safeName = module.source.replace(/[^a-zA-Z0-9]/g, "_");
    return `  "${safeName}" [label="${module.source}"];`;
  })
  .join("\n")}

${jsonData.modules
  .flatMap((module) =>
    module.dependencies.map((dep) => {
      const sourceName = module.source.replace(/[^a-zA-Z0-9]/g, "_");
      const targetName = dep.resolved.replace(/[^a-zA-Z0-9]/g, "_");
      return `  "${sourceName}" -> "${targetName}";`;
    })
  )
  .join("\n")}
}`;

    fs.writeFileSync(outputPath, dotContent);
    console.log(`✔ DOT 檔案已生成：${outputPath}`);
    return true;
  } catch (error) {
    console.error(`✗ 生成 DOT 檔案失敗：${error.message}`);
    return false;
  }
};

const generateSvgFromDot = async (dotPath, svgPath) => {
  try {
    // 檢查是否安裝了 graphviz
    try {
      await execAsync("dot -V");
    } catch {
      console.log("⚠ 未安裝 Graphviz，正在嘗試安裝...");
      if (process.platform === "darwin") {
        await execAsync("brew install graphviz");
        console.log("✔ Graphviz 安裝完成");
      } else {
        console.log("請手動安裝 Graphviz：");
        console.log("Ubuntu/Debian: sudo apt-get install graphviz");
        console.log("CentOS/RHEL: sudo yum install graphviz");
        console.log("Windows: choco install graphviz");
        return false;
      }
    }

    await execAsync(`dot -Tsvg "${dotPath}" -o "${svgPath}"`);
    console.log(`✔ SVG 圖形檔已生成：${svgPath}`);
    return true;
  } catch (error) {
    console.error(`✗ 生成 SVG 檔案失敗：${error.message}`);
    return false;
  }
};

// 將 dependency-cruiser 格式轉換為 Cytoscape 格式
const convertToCytoscapeFormat = (depCruiserData) => {
  try {
    const cytoscapeElements = [];
    const processedNodes = new Set();

    // 處理所有模組並創建節點和邊線
    depCruiserData.modules.forEach((module) => {
      const moduleId = module.source;

      // 創建源節點（如果尚未處理）
      if (!processedNodes.has(moduleId)) {
        cytoscapeElements.push({
          data: {
            id: moduleId,
            label: getFileDisplayName(moduleId),
            type: getFileType(moduleId),
          },
        });
        processedNodes.add(moduleId);
      }

      // 處理依賴關係
      module.dependencies.forEach((dep) => {
        const targetId = dep.resolved;

        // 創建目標節點（如果尚未處理）
        if (!processedNodes.has(targetId)) {
          cytoscapeElements.push({
            data: {
              id: targetId,
              label: getFileDisplayName(targetId),
              type: getFileType(targetId),
            },
          });
          processedNodes.add(targetId);
        }

        // 創建邊線
        const edgeId = `${moduleId}->${targetId}`;
        cytoscapeElements.push({
          data: {
            id: edgeId,
            source: moduleId,
            target: targetId,
            type: getDependencyType(dep.dependencyTypes),
          },
        });
      });
    });

    return cytoscapeElements;
  } catch (error) {
    console.error(`✗ 轉換 Cytoscape 格式失敗：${error.message}`);
    return [];
  }
};

// 獲取檔案顯示名稱
const getFileDisplayName = (filePath) => {
  const fileName = path.basename(filePath);
  // 如果是 index 檔案，顯示包含父目錄的名稱
  if (fileName.startsWith("index.")) {
    const parentDir = path.basename(path.dirname(filePath));
    return `${parentDir}/${fileName}`;
  }
  return fileName;
};

// 根據檔案路徑判斷檔案類型
const getFileType = (filePath) => {
  if (filePath.includes("/pages/") || filePath.includes("/app/"))
    return "pages";
  if (filePath.includes("/components/")) return "components";
  if (filePath.includes("/utils/")) return "utils";
  if (filePath.includes("/lib/")) return "lib";
  if (filePath.includes("/hooks/") || filePath.includes("use")) return "hooks";
  if (filePath.includes("/types/") || filePath.includes(".d.ts"))
    return "types";
  if (filePath.includes("/api/")) return "api";
  return "default";
};

// 根據依賴類型判斷連線類型
const getDependencyType = (dependencyTypes) => {
  if (dependencyTypes.includes("dynamic")) return "dynamic";
  if (dependencyTypes.includes("import")) return "import";
  if (dependencyTypes.includes("require")) return "require";
  return "unknown";
};

const run = async () => {
  try {
    console.log("🔍 互動式依賴分析工具");
    console.log("=".repeat(30));

    const {
      targetDir,
      initConfig,
      jsonOutput,
      generateCytoscape,
      generateDot,
      generateSvg,
    } = await askQuestions();

    const configFile = ".dependency-cruiser.js";
    const configPath = path.resolve(configFile);

    // 建立設定檔
    if (initConfig && !fs.existsSync(configPath)) {
      createDefaultConfig(configPath);
    }

    // 檢查目標目錄是否存在
    if (!fs.existsSync(targetDir)) {
      console.error(`✗ 目標目錄不存在：${targetDir}`);
      return;
    }

    console.log(`\n🚀 開始分析目錄：${targetDir}`);

    // 執行依賴分析
    const options = {
      outputType: "json",
      exclude: "node_modules",
      doNotFollow: { path: "node_modules" },
    };

    if (fs.existsSync(configPath)) {
      options.ruleSet = configPath;
    }

    const result = cruise([targetDir], options);

    if (result.output && result.output.modules) {
      // 寫入 JSON 檔案
      const jsonPath = path.resolve(jsonOutput);
      fs.writeFileSync(jsonPath, JSON.stringify(result.output, null, 2));
      console.log(`✔ 分析完成，JSON 輸出：${jsonPath}`);

      // 顯示統計資訊
      const stats = {
        totalModules: result.output.modules.length,
        totalDependencies: result.output.modules.reduce(
          (sum, mod) => sum + mod.dependencies.length,
          0
        ),
        circularDependencies:
          result.output.summary?.violations?.filter(
            (v) => v.rule.name === "no-circular"
          )?.length || 0,
      };

      console.log("\n📊 分析統計：");
      console.log(`   模組數量：${stats.totalModules}`);
      console.log(`   依賴關係：${stats.totalDependencies}`);
      console.log(`   循環依賴：${stats.circularDependencies}`);

      // 生成 Cytoscape 格式檔案
      if (generateCytoscape) {
        const cytoscapeElements = convertToCytoscapeFormat(result.output);
        const cytoscapePath = jsonPath.replace(/\.json$/, "-cytoscape.json");

        // 如果用戶選擇預設檔名，直接替換為 cytoscape-elements.json
        const finalCytoscapePath =
          jsonOutput === "dependency-graph.json"
            ? path.resolve("public/cytoscape-elements.json")
            : cytoscapePath;

        // 確保 public 目錄存在
        const outputDir = path.dirname(finalCytoscapePath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(
          finalCytoscapePath,
          JSON.stringify(cytoscapeElements, null, 2)
        );
        console.log(`✔ Cytoscape 格式檔案已生成：${finalCytoscapePath}`);
        console.log(
          `   📝 節點數量：${
            cytoscapeElements.filter((el) => !el.data.source).length
          }`
        );
        console.log(
          `   🔗 邊線數量：${
            cytoscapeElements.filter((el) => el.data.source).length
          }`
        );

        // 如果是預設路徑，提示使用者可以直接查看前端
        if (finalCytoscapePath.includes("public/cytoscape-elements.json")) {
          console.log(`\n🌐 您現在可以啟動前端服務查看依賴圖：`);
          console.log(`   npm run dev`);
          console.log(`   然後在瀏覽器中訪問 http://localhost:3030`);
        }
      }

      // 生成 DOT 檔案
      if (generateDot) {
        const dotPath = jsonPath.replace(/\.json$/, ".dot");
        await generateDotFile(result.output, dotPath);

        // 生成 SVG 檔案
        if (generateSvg) {
          const svgPath = jsonPath.replace(/\.json$/, ".svg");
          await generateSvgFromDot(dotPath, svgPath);
        }
      }
    } else {
      console.error("✗ 分析失敗，無法取得結果");
    }
  } catch (error) {
    console.error(`✗ 執行錯誤：${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
};

// 執行主程式
run().catch(console.error);
