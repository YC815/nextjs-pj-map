"use client"
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Background,
  MiniMap,
  Controls,
  Node,
  Edge,
  Position,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import Fuse from "fuse.js";
import { MagnifyingGlassIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { API_CONFIG, API_ENDPOINTS } from "../lib/config";

// 動態載入 ReactFlow 以避免 SSR 問題
const ReactFlowDynamic = dynamic(
  () => import("reactflow").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">載入圖形視圖中...</p>
        </div>
      </div>
    ),
  }
);

type CytoscapeElement =
  | { data: { id: string; type?: string; label?: string; sourceFile?: string } }
  | { data: { source: string; target: string; type?: string } };

// 定義 Docker 分析類型
interface DockerAPI {
  name?: string;
  apiType?: string;
  description: string;
  line?: number;
  codeSnippet?: string;
}

interface DockerAnalysisResult {
  hasDockerIntegration: boolean;
  dockerTools: string[];
  dockerApis: DockerAPI[];
  summary: string;
}

interface AnalysisStats {
  dockerIntegrationCount: number;
  totalAnalyzed: number;
  [key: string]: number;
}



// 檔案類型配置
const FILE_TYPES = {
  pages: { color: "#16a34a", icon: "📄", label: "Pages", textColor: "#ffffff" },
  components: { color: "#2563eb", icon: "🧩", label: "Components", textColor: "#ffffff" },
  utils: { color: "#64748b", icon: "🔧", label: "Utils", textColor: "#ffffff" },
  lib: { color: "#7c3aed", icon: "📚", label: "Libraries", textColor: "#ffffff" },
  hooks: { color: "#dc2626", icon: "🪝", label: "Hooks", textColor: "#ffffff" },
  types: { color: "#ea580c", icon: "📝", label: "Types", textColor: "#ffffff" },
  api: { color: "#059669", icon: "🌐", label: "API", textColor: "#ffffff" },
  default: { color: "#1f2937", icon: "📁", label: "Other", textColor: "#ffffff" },
  // Docker 節點類型
  docker_api: { color: "#1e40af", icon: "🔌", label: "Docker API", textColor: "#ffffff" },
  docker_tool: { color: "#059669", icon: "🛠️", label: "Docker Tool", textColor: "#ffffff" },
  docker_config: { color: "#d97706", icon: "⚙️", label: "Docker Config", textColor: "#ffffff" },
  docker_service: { color: "#7c3aed", icon: "🚀", label: "Docker Service", textColor: "#ffffff" },
} as const;

// dagre 布局配置
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 200;
const nodeHeight = 50;

// Docker 名稱友好化函數
function getFriendlyDockerName(name: string): string {
  const nameMap: Record<string, string> = {
    'DockerAIEditorManager': 'Docker AI 編輯器管理器',
    'createDockerToolkit': '建立 Docker 工具包',
    'dockerConfigManager.autoDetectDockerContext': 'Docker 配置自動檢測',
    'DockerToolkit': 'Docker 工具包',
    'DockerContext': 'Docker 上下文',
    'dockerReadFile': 'Docker 讀取檔案',
    'dockerWriteFile': 'Docker 寫入檔案',
    'dockerListDirectory': 'Docker 列出目錄',
    'dockerFindFiles': 'Docker 搜尋檔案',
    'dockerCheckPathExists': 'Docker 檢查路徑',
    'dockerGetProjectInfo': 'Docker 取得專案資訊',
    'securityValidator': '安全性驗證器',
    'docker_start_dev_server': 'Docker 啟動開發伺服器',
    'docker_restart_dev_server': 'Docker 重啟開發伺服器',
    'docker_read_log_tail': 'Docker 讀取日誌',
    'docker_check_health': 'Docker 健康檢查',
  };
  
  return nameMap[name] || name;
}

// 取得節點類型 - 純函數優化（支援 Docker 節點）
function getNodeType(id: string, nodeType?: string): keyof typeof FILE_TYPES {
  // 如果有明確的節點類型，優先使用（Docker 節點）
  if (nodeType && nodeType in FILE_TYPES) {
    return nodeType as keyof typeof FILE_TYPES;
  }
  
  // 檔案節點類型判斷
  if (id.includes("pages/") || id.includes("app/")) return "pages";
  if (id.includes("components/")) return "components";
  if (id.includes("utils/")) return "utils";
  if (id.includes("lib/")) return "lib";
  if (id.includes("hooks/") || id.includes("use")) return "hooks";
  if (id.includes("types/") || id.includes(".d.ts")) return "types";
  if (id.includes("api/")) return "api";
  return "default";
}

// 取得節點樣式 - 純函數優化（支援 Docker 節點）
function getNodeStyle(id: string, nodeType?: string, isHighlighted = false, isFiltered = false) {
  const type = getNodeType(id, nodeType);
  const config = FILE_TYPES[type];
  
  return {
    background: isHighlighted ? "#fbbf24" : config.color,
    color: isHighlighted ? "#000000" : config.textColor,
    fontSize: 12,
    fontWeight: 600,
    padding: 10,
    borderRadius: 8,
    border: isHighlighted ? "3px solid #f59e0b" : "2px solid rgba(255,255,255,0.3)",
    opacity: isFiltered ? 0.3 : 1,
    boxShadow: isHighlighted 
      ? "0 0 20px rgba(245, 158, 11, 0.6)" 
      : "0 4px 8px rgba(0,0,0,0.15)",
    transition: "all 0.3s ease",
    backdropFilter: "blur(1px)",
  };
}

// dagre 布局函數 - 純函數優化
function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  dagreGraph.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 300 });

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

// Docker 統計組件
const DockerStats = React.memo(({ 
  analysisStats
}: {
  analysisStats: AnalysisStats | null;
}) => (
  <div className="flex items-center gap-3">
    {analysisStats && (
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg">
        <span className="text-sm font-medium text-blue-700">
          🐳 Docker 整合檔案: {analysisStats.dockerIntegrationCount}
        </span>
        <span className="text-xs text-blue-600">
          總計: {analysisStats.totalAnalyzed}
        </span>
      </div>
    )}
  </div>
));

DockerStats.displayName = 'DockerStats';

// 檔案類型濾鏡組件
const FileTypeFilters = React.memo(({ 
  stats, 
  activeFilters, 
  onToggleFilter 
}: {
  stats: Record<string, number>;
  activeFilters: Set<keyof typeof FILE_TYPES>;
  onToggleFilter: (fileType: keyof typeof FILE_TYPES) => void;
}) => (
  <div className="flex flex-wrap gap-2">
    {Object.entries(FILE_TYPES).map(([key, config]) => {
      const count = stats[key] || 0;
      if (count === 0) return null;
      
      const isActive = activeFilters.has(key as keyof typeof FILE_TYPES);
      
      return (
        <button
          key={key}
          onClick={() => onToggleFilter(key as keyof typeof FILE_TYPES)}
          className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold transition-all border-2 ${
            isActive 
              ? 'bg-gray-200 text-gray-500 opacity-50 border-gray-300' 
              : 'bg-white text-gray-800 hover:bg-gray-50 border-gray-300 hover:border-gray-400 shadow-sm hover:shadow-md'
          }`}
        >
          <span 
            className="w-4 h-4 rounded-full mr-2 border border-white shadow-sm"
            style={{ backgroundColor: config.color }}
          ></span>
          {config.icon} {config.label} ({count})
        </button>
      );
    })}
  </div>
));

FileTypeFilters.displayName = 'FileTypeFilters';

// 搜尋結果面板組件
const SearchResultsPanel = React.memo(({ 
  searchResults,
  searchTerm,
  onSelectResult,
  onClosePanel
}: {
  searchResults: Node[];
  searchTerm: string;
  onSelectResult: (node: Node) => void;
  onClosePanel: () => void;
}) => {
  return (
    <div className="w-80 bg-white/95 backdrop-blur-sm border-l-2 border-gray-300 p-6 overflow-y-auto shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          搜尋結果 ({searchResults.length})
        </h2>
        <button
          onClick={onClosePanel}
          className="text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full p-2 transition-all text-lg font-bold"
        >
          ✕
        </button>
      </div>

      <div className="mb-4 p-3 bg-blue-50 rounded-lg">
        <div className="flex items-center gap-2">
          <MagnifyingGlassIcon className="h-4 w-4 text-blue-600" />
          <span className="text-sm text-blue-700">
            搜尋關鍵字：<strong>&quot;{searchTerm}&quot;</strong>
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {searchResults.map((node, index) => {
          const nodeType = getNodeType(node.id, node.data?.nodeType);
          const config = FILE_TYPES[nodeType];
          const isDockerNode = node.data.nodeType?.startsWith('docker_');
          
          return (
            <div
              key={`${node.id}-${index}`}
              className="p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md"
              onClick={() => onSelectResult(node)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <span className="text-2xl">{config.icon}</span>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span 
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: config.color }}
                    ></span>
                    <span className="text-xs text-gray-500 uppercase font-medium">
                      {config.label}
                    </span>
                    {isDockerNode && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded-full">
                        🐳 Docker
                      </span>
                    )}
                  </div>
                  
                  <h3 className="font-medium text-gray-900 mb-1 truncate">
                    {node.data.label}
                  </h3>
                  
                  <p className="text-sm text-gray-600 truncate">
                    {node.data.fullPath}
                  </p>
                  
                  {/* Docker 節點額外資訊 */}
                  {isDockerNode && node.data.sourceFile && (
                    <div className="mt-2 text-xs text-blue-600">
                      📁 來源: {node.data.sourceFile}
                    </div>
                  )}
                </div>
                
                <div className="flex-shrink-0">
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {searchResults.length === 0 && (
        <div className="text-center py-8">
          <div className="text-gray-400 mb-2">
            <MagnifyingGlassIcon className="h-12 w-12 mx-auto" />
          </div>
          <p className="text-gray-500">沒有找到相關的檔案</p>
        </div>
      )}
    </div>
  );
});

SearchResultsPanel.displayName = 'SearchResultsPanel';

function App() {
  const [mounted, setMounted] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [originalNodes, setOriginalNodes] = useState<Node[]>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<keyof typeof FILE_TYPES>>(new Set());
  const [fuse, setFuse] = useState<Fuse<Node> | null>(null);
  const [dockerAnalysis, setDockerAnalysis] = useState<Record<string, DockerAnalysisResult>>({});
  const [analysisStats, setAnalysisStats] = useState<AnalysisStats | null>(null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [searchResults, setSearchResults] = useState<Node[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  
  // ReactFlow 實例引用
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // 客戶端渲染檢查
  useEffect(() => {
    setMounted(true);
  }, []);

  // 載入數據
  useEffect(() => {
    if (!mounted) return;
    
    let isCancelled = false;
    
    const loadData = async () => {
      // 先載入 Docker 分析數據
      let dockerData: Record<string, DockerAnalysisResult> = {};
      try {
        const dockerRes = await fetch(API_CONFIG.getApiUrl(API_ENDPOINTS.DOCKER_ANALYSIS));
        dockerData = await dockerRes.json();
        setDockerAnalysis(dockerData);
      } catch (err) {
        console.log("Docker 分析數據載入失敗:", err);
      }
      
      try {
        // 直接載入基礎圖形數據
        const res = await fetch("/cytoscape-elements.json");
        const data: CytoscapeElement[] = await res.json();
        
        if (isCancelled) return;
        
        const nodeMap = new Map<string, Node>();
        const edgeList: Edge[] = [];

        // 建立所有節點（包括檔案節點和 Docker 節點）
        data.forEach((el: CytoscapeElement) => {
          if ("id" in el.data) {
            const id = el.data.id;
            const nodeType = el.data.type;
            const providedLabel = el.data.label;
            const type = getNodeType(id, nodeType);
            const config = FILE_TYPES[type];
            
            // 設定節點標籤
            let label: string;
            if (providedLabel) {
              label = providedLabel;
            } else {
              label = `${config.icon} ${id.split('/').pop() || id}`;
            }
            
            nodeMap.set(id, {
              id,
              data: { 
                label,
                fullPath: id,
                fileType: type,
                nodeType,
                sourceFile: el.data.sourceFile,
              },
              position: { x: 0, y: 0 },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
              style: getNodeStyle(id, nodeType),
            });
          } else if ("source" in el.data && "target" in el.data) {
            const { source, target, type } = el.data;
            const edgeId = `${source}->${target}`;
            // 檢查是否已存在相同的邊線，避免重複
            if (!edgeList.find(edge => edge.id === edgeId)) {
              const edgeStyle = type === 'docker_integration' 
                ? { stroke: "#3b82f6", strokeWidth: 3, strokeDasharray: "5,5" }
                : { stroke: "#94a3b8", strokeWidth: 2 };
              
              edgeList.push({
                id: edgeId,
                source,
                target,
                animated: type === 'docker_integration',
                style: edgeStyle,
                data: { type },
              });
            }
          }
        });

        if (isCancelled) return;

        // 在設置初始節點之前先創建 Docker 節點
        console.log("dockerData:", dockerData); // 調試日誌
        console.log("Creating Docker nodes..."); // 調試日誌

        // 根據 Docker 分析數據為每個檔案創建對應的 Docker API 節點
        Object.entries(dockerData || {}).forEach(([fileKey, analysis]: [string, DockerAnalysisResult]) => {
          if (analysis.hasDockerIntegration) {
            const fileName = fileKey.replace('github:', '');
            console.log(`Processing Docker integration for file: ${fileName}`); // 調試日誌
            console.log(`Docker APIs:`, analysis.dockerApis); // 調試日誌
            console.log(`Docker Tools:`, analysis.dockerTools); // 調試日誌
            
            // 為每個 Docker API 創建獨立的藍色節點
            (analysis.dockerApis || []).forEach((api: DockerAPI, index: number) => {
              // 使用 API 的 name 或 apiType 作為標識
              const apiName = api.name || api.apiType || `api_${index}`;
              
              // 創建友好的中文名稱
              const friendlyName = getFriendlyDockerName(apiName);
              
              const dockerApiId = `docker_api_${fileName}_${apiName}_${index}`;
              console.log(`Creating Docker API node: ${dockerApiId} with friendly name: ${friendlyName}`); // 調試日誌
              
              nodeMap.set(dockerApiId, {
                id: dockerApiId,
                data: {
                  label: `🔌 ${friendlyName}`,
                  fullPath: dockerApiId,
                  fileType: 'docker_api',
                  nodeType: 'docker_api',
                  sourceFile: fileName,
                  dockerInfo: { 
                    apiName: apiName,
                    friendlyName: friendlyName,
                    description: api.description,
                    sourceFile: fileName,
                    originalApi: api
                  }
                },
                position: { x: 0, y: 0 },
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                style: getNodeStyle(dockerApiId, 'docker_api'),
              });

              // 創建從檔案到 Docker API 的連線
              const edgeId = `${fileName}->${dockerApiId}`;
              if (!edgeList.find(edge => edge.id === edgeId)) {
                edgeList.push({
                  id: edgeId,
                  source: fileName,
                  target: dockerApiId,
                  animated: true,
                  style: { stroke: "#1e40af", strokeWidth: 2, strokeDasharray: "3,3" },
                  data: { type: 'docker_api_usage' },
                });
                console.log(`Created edge from ${fileName} to ${dockerApiId}`); // 調試日誌
              }
            });

            // 為每個 Docker 工具創建獨立的綠色節點
            (analysis.dockerTools || []).forEach((tool: string, index: number) => {
              const friendlyName = getFriendlyDockerName(tool);
              const dockerToolId = `docker_tool_${fileName}_${tool}_${index}`;
              console.log(`Creating Docker tool node: ${dockerToolId} with friendly name: ${friendlyName}`); // 調試日誌
              
              nodeMap.set(dockerToolId, {
                id: dockerToolId,
                data: {
                  label: `🛠️ ${friendlyName}`,
                  fullPath: dockerToolId,
                  fileType: 'docker_tool',
                  nodeType: 'docker_tool',
                  sourceFile: fileName,
                  dockerInfo: { 
                    tool: tool,
                    friendlyName: friendlyName,
                    sourceFile: fileName
                  }
                },
                position: { x: 0, y: 0 },
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                style: getNodeStyle(dockerToolId, 'docker_tool'),
              });

              // 創建從檔案到 Docker 工具的連線
              const edgeId = `${fileName}->${dockerToolId}`;
              if (!edgeList.find(edge => edge.id === edgeId)) {
                edgeList.push({
                  id: edgeId,
                  source: fileName,
                  target: dockerToolId,
                  animated: true,
                  style: { stroke: "#059669", strokeWidth: 2, strokeDasharray: "3,3" },
                  data: { type: 'docker_tool_usage' },
                });
                console.log(`Created edge from ${fileName} to ${dockerToolId}`); // 調試日誌
              }
            });
          }
        });

        if (isCancelled) return;

        // 使用 dagre 進行自動布局
        const initialNodes = Array.from(nodeMap.values());
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          initialNodes,
          edgeList
        );

        setOriginalNodes(initialNodes);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);

        // 設置搜尋引擎
        const fuseInstance = new Fuse(initialNodes, {
          keys: ["data.fullPath", "data.label"],
          threshold: 0.3,
        });
        setFuse(fuseInstance);
      } catch (error) {
        console.error("載入數據失敗:", error);
        // 如果載入失敗，至少設置空的節點和邊線
        setNodes([]);
        setEdges([]);
        setOriginalNodes([]);
      }
    };
    
    loadData();
    
    return () => {
      isCancelled = true;
    };
  }, [mounted]);

  // 載入已有的摘要快取和 Docker 分析
  useEffect(() => {
    if (!mounted) return;
    
    let isCancelled = false;
    
    const loadAnalysisData = async () => {
      try {
        const [summariesRes, dockerRes, statsRes] = await Promise.all([
          fetch(API_CONFIG.getApiUrl(API_ENDPOINTS.SUMMARIES)),
          fetch(API_CONFIG.getApiUrl(API_ENDPOINTS.DOCKER_ANALYSIS)),
          fetch(API_CONFIG.getApiUrl(API_ENDPOINTS.ANALYSIS_STATS))
        ]);
        
        if (isCancelled) return;
        
        const [summariesData, dockerData, statsData] = await Promise.all([
          summariesRes.json(),
          dockerRes.json(),
          statsRes.json()
        ]);
        
        if (isCancelled) return;
        
        setSummaries(summariesData);
        setDockerAnalysis(dockerData);
        setAnalysisStats(statsData);
      } catch (err) {
        console.log("摘要伺服器尚未啟動或無法連接:", err);
      }
    };
    
    loadAnalysisData();
    
    return () => {
      isCancelled = true;
    };
  }, [mounted]);





  // ReactFlow 初始化回調
  const onInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
  }, []);

  // 選中節點並平滑移動視窗
  const selectNodeAndMove = useCallback((node: Node) => {
    setSelectedNode(node);
    setHighlightedNode(node.id);
    
    // 平滑移動到選中的節點
    if (reactFlowInstance.current) {
      const nodePosition = node.position;
      const x = nodePosition.x + (nodeWidth / 2);
      const y = nodePosition.y + (nodeHeight / 2);
      
      reactFlowInstance.current.setCenter(x, y, { zoom: 1.2, duration: 800 });
    }
  }, []);

  // 搜尋功能 - 修改為顯示所有結果
  const handleSearch = useCallback((term: string) => {
    setSearchTerm(term);
    
    if (!term.trim() || !fuse) {
      setHighlightedNode(null);
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    const results = fuse.search(term);
    const foundNodes = results.map(result => result.item);
    
    setSearchResults(foundNodes);
    setShowSearchResults(foundNodes.length > 0);
    
    // 如果有結果，高亮第一個但不自動移動
    if (foundNodes.length > 0) {
      setHighlightedNode(foundNodes[0].id);
    }
  }, [fuse]);

  // 選擇搜尋結果並關閉搜尋面板
  const selectSearchResult = useCallback((node: Node) => {
    selectNodeAndMove(node);
    setShowSearchResults(false);
    setSelectedNode(node);
  }, [selectNodeAndMove]);

  // 濾鏡功能
  const toggleFilter = useCallback((fileType: keyof typeof FILE_TYPES) => {
    const newFilters = new Set(activeFilters);
    if (newFilters.has(fileType)) {
      newFilters.delete(fileType);
    } else {
      newFilters.add(fileType);
    }
    setActiveFilters(newFilters);
  }, [activeFilters]);

  // 導航到主頁（page.tsx）的函數
  const navigateToHomePage = useCallback(() => {
    const homePageNode = nodes.find(node => 
      node.id.includes('page.tsx') || 
      node.id.includes('src/app/page.tsx') ||
      node.data.fullPath.includes('page.tsx')
    );
    
    if (homePageNode) {
      selectNodeAndMove(homePageNode);
    }
  }, [nodes, selectNodeAndMove]);

  // 切換工具列顯示/隱藏
  const toggleToolbar = useCallback(() => {
    setIsToolbarCollapsed(!isToolbarCollapsed);
  }, [isToolbarCollapsed]);

  // 重新布局
  const handleRelayout = useCallback(() => {
    const { nodes: layoutedNodes } = getLayoutedElements(nodes, edges);
    setNodes(layoutedNodes);
  }, [nodes, edges]);

  // 動態計算節點樣式和篩選，避免循環依賴
  const displayNodes = useMemo(() => {
    console.log("Filtering nodes. Total nodes:", nodes.length); // 調試日誌
    
    const filtered = nodes
      .map(node => ({
        ...node,
        style: getNodeStyle(
          node.id,
          node.data.nodeType,
          node.id === highlightedNode,
          activeFilters.size > 0 && !activeFilters.has(getNodeType(node.id, node.data.nodeType))
        )
      }));
      
    console.log("Filtered nodes count:", filtered.length); // 調試日誌
    return filtered;
  }, [nodes, highlightedNode, activeFilters]);

  // 節點點擊處理
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setHighlightedNode(node.id);
  }, []);

  // 統計資訊 - 使用 useMemo 優化
  const stats = useMemo(() => {
    return originalNodes.reduce((acc, node) => {
      const type = getNodeType(node.id, node.data.nodeType);
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [originalNodes]);



  // 如果還沒有客戶端渲染，顯示載入畫面
  if (!mounted) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">正在載入依賴圖視圖...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex">
      {/* 主要圖形區域 */}
      <div className="flex-1 relative min-w-0">
        {/* 工具列收起/展開按鈕 */}
        <div className="absolute top-4 left-4 z-20">
          <button
            onClick={toggleToolbar}
            className="p-3 bg-white/95 backdrop-blur-sm text-gray-700 rounded-lg hover:bg-gray-100 transition-all duration-200 shadow-md border border-gray-200"
            title={isToolbarCollapsed ? "展開工具列" : "收起工具列"}
          >
            {isToolbarCollapsed ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>

        {/* 頂部工具列 */}
        {!isToolbarCollapsed && (
          <div className="absolute top-4 left-20 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-xl border border-gray-200 p-4 max-w-4xl">
            {/* 搜尋欄和按鈕區域 */}
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="搜尋檔案... (例: Header, Button)"
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium text-gray-900 bg-white"
                />
              </div>
              
              {/* Docker 統計資訊 */}
              <DockerStats 
                analysisStats={analysisStats}
              />
              
              {/* 導航到主頁按鈕 */}
              <button
                onClick={navigateToHomePage}
                className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all duration-200 shadow-md hover:shadow-lg font-medium text-sm"
                title="導航到主頁 (page.tsx)"
              >
                🏠 主頁
              </button>
              
              <button
                onClick={handleRelayout}
                className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 shadow-md hover:shadow-lg font-medium"
                title="重新排版"
              >
                <ArrowPathIcon className="h-4 w-4" />
              </button>
            </div>

            {/* 檔案類型濾鏡 */}
            <FileTypeFilters 
              stats={stats}
              activeFilters={activeFilters}
              onToggleFilter={toggleFilter}
            />
          </div>
        )}

        <ReactFlowDynamic 
          nodes={displayNodes} 
          edges={edges} 
          onNodeClick={onNodeClick}
          onInit={onInit}
          fitView
          panOnDrag={true}
          zoomOnScroll={true}
          fitViewOptions={{ padding: 0.2, minZoom: 0.1, maxZoom: 4 }}
          minZoom={0.1}
          maxZoom={4}
        >
          <MiniMap 
            style={{ 
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0"
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
          <Controls />
          <Background 
            color="#e2e8f0" 
            gap={20} 
          />
        </ReactFlowDynamic>
      </div>

      {/* 右側資訊面板 */}
      {showSearchResults && (
        <div className="mr-8">
          <SearchResultsPanel 
            searchResults={searchResults}
            searchTerm={searchTerm}
            onSelectResult={selectSearchResult}
            onClosePanel={() => setShowSearchResults(false)}
          />
        </div>
      )}
      
      {!showSearchResults && selectedNode && (
        <div className="mr-8">
          <NodeInfoPanel 
            selectedNode={selectedNode}
            edges={edges}
            nodes={nodes}
            dockerAnalysis={dockerAnalysis}
            summaries={summaries}
            onClosePanel={() => setSelectedNode(null)}
            onSelectNode={selectNodeAndMove}
          />
        </div>
      )}
    </div>
  );
}



// 右側節點資訊面板組件
const NodeInfoPanel = React.memo(({ 
  selectedNode,
  edges,
  nodes,
  dockerAnalysis,
  summaries,
  onClosePanel,
  onSelectNode
}: {
  selectedNode: Node;
  edges: Edge[];
  nodes: Node[];
  dockerAnalysis: Record<string, DockerAnalysisResult>;
  summaries: Record<string, string>;
  onClosePanel: () => void;
  onSelectNode: (node: Node) => void;
}) => {
  // 計算依賴關係 - 使用 useMemo 優化
  const dependencies = useMemo(() => {
    const incomingDeps = edges.filter(edge => edge.target === selectedNode.id).length;
    const outgoingDeps = edges.filter(edge => edge.source === selectedNode.id).length;
    return { incoming: incomingDeps, outgoing: outgoingDeps };
  }, [edges, selectedNode.id]);

  // 相關檔案 - 使用 useMemo 優化
  const relatedFiles = useMemo(() => {
    return edges
      .filter(edge => edge.source === selectedNode.id || edge.target === selectedNode.id)
      .slice(0, 5)
      .map((edge, index) => {
        const relatedId = edge.source === selectedNode.id ? edge.target : edge.source;
        const isOutgoing = edge.source === selectedNode.id;
        const uniqueKey = `${selectedNode.id}-${relatedId}-${index}-${isOutgoing ? 'out' : 'in'}`;
        return { relatedId, isOutgoing, uniqueKey };
      });
  }, [edges, selectedNode.id]);

  const nodeType = getNodeType(selectedNode.id, selectedNode.data?.nodeType);
  const config = FILE_TYPES[nodeType];

  return (
    <div className="w-80 bg-white/95 backdrop-blur-sm border-l-2 border-gray-300 p-6 overflow-y-auto shadow-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">檔案資訊</h2>
        <button
          onClick={onClosePanel}
          className="text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-full p-2 transition-all text-lg font-bold"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        {/* 檔案基本資訊 */}
        <NodeBasicInfo 
          selectedNode={selectedNode}
          config={config}
        />

        {/* 檔案摘要 */}
        <NodeSummary 
          selectedNode={selectedNode}
          summaries={summaries}
          dockerAnalysis={dockerAnalysis}
        />

        {/* 依賴統計 */}
        <NodeDependencies dependencies={dependencies} />

        {/* Docker 整合分析 */}
        <NodeDockerAnalysis 
          selectedNode={selectedNode}
          dockerAnalysis={dockerAnalysis}
        />

        {/* 相關檔案 */}
        <NodeRelatedFiles 
          relatedFiles={relatedFiles}
          nodes={nodes}
          onSelectNode={onSelectNode}
        />
      </div>
    </div>
  );
});

NodeInfoPanel.displayName = 'NodeInfoPanel';

// 節點基本資訊組件
const NodeBasicInfo = React.memo(({ 
  selectedNode, 
  config
}: {
  selectedNode: Node;
  config: typeof FILE_TYPES[keyof typeof FILE_TYPES];
}) => {
  const isDockerNode = selectedNode.data.nodeType?.startsWith('docker_');
  
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <div className="text-2xl mb-2">{config.icon}</div>
      <h3 className="font-medium text-gray-900 mb-2">
        {selectedNode.data.fullPath}
      </h3>
      <div className="flex items-center gap-2 mb-2">
        <span 
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: config.color }}
        ></span>
        <span className="text-sm text-gray-600">
          {config.label}
        </span>
      </div>
      
      {/* Docker 節點特殊資訊 */}
      {isDockerNode && selectedNode.data.sourceFile && (
        <div className="bg-blue-50 p-2 rounded mb-3 text-xs">
          <span className="text-blue-700">
            📁 來源檔案: {selectedNode.data.sourceFile}
          </span>
        </div>
      )}

      {/* Docker 節點詳細資訊 */}
      {isDockerNode && selectedNode.data.dockerInfo && (
        <div className="bg-blue-50 p-3 rounded mb-3">
          <h5 className="font-medium text-blue-800 mb-2">🐳 Docker 功能詳細</h5>
          
          {/* Docker API 資訊 */}
          {selectedNode.data.dockerInfo.apiName && (
            <div className="text-sm text-blue-700 space-y-2">
              <div><strong>功能名稱：</strong> {selectedNode.data.dockerInfo.friendlyName}</div>
              <div><strong>英文名稱：</strong> {selectedNode.data.dockerInfo.apiName}</div>
              {selectedNode.data.dockerInfo.description && (
                <div><strong>功能描述：</strong> {selectedNode.data.dockerInfo.description}</div>
              )}
              <div><strong>來源檔案：</strong> {selectedNode.data.dockerInfo.sourceFile}</div>
            </div>
          )}

          {/* Docker 工具資訊 */}
          {selectedNode.data.dockerInfo.tool && (
            <div className="text-sm text-blue-700 space-y-2">
              <div><strong>工具名稱：</strong> {selectedNode.data.dockerInfo.friendlyName}</div>
              <div><strong>英文名稱：</strong> {selectedNode.data.dockerInfo.tool}</div>
              <div><strong>來源檔案：</strong> {selectedNode.data.dockerInfo.sourceFile}</div>
            </div>
          )}
        </div>
      )}
      
      {/* 檔案來源顯示 - 只對非Docker節點顯示 */}
      {!isDockerNode && (
        <div className="flex gap-2 mt-3">
          <div className="px-3 py-1 bg-purple-100 text-purple-700 text-xs rounded flex items-center gap-1">
            🐙 GitHub: YC815/ai-web-ide
          </div>
        </div>
      )}
    </div>
  );
});

NodeBasicInfo.displayName = 'NodeBasicInfo';

// 節點摘要組件
const NodeSummary = React.memo(({ 
  selectedNode, 
  summaries,
  dockerAnalysis
}: {
  selectedNode: Node;
  summaries: Record<string, string>;
  dockerAnalysis: Record<string, DockerAnalysisResult>;
}) => {
  // 檢查是否為 Docker 節點
  const isDockerNode = selectedNode.data.nodeType?.startsWith('docker_');
  
  let summary = '';
  let isDockerSummary = false;

  if (isDockerNode) {
    // Docker 節點的摘要
    if (selectedNode.data.dockerInfo?.tool) {
      summary = `這是一個 Docker 工具節點，代表 "${selectedNode.data.dockerInfo.friendlyName}" 工具。此工具用於容器化開發環境的管理和操作，來源於 ${selectedNode.data.dockerInfo.sourceFile} 檔案。`;
    } else if (selectedNode.data.dockerInfo?.apiName) {
      summary = `這是一個 Docker API 節點，代表 "${selectedNode.data.dockerInfo.friendlyName}" 功能。${selectedNode.data.dockerInfo.description || '此 API 用於與 Docker 容器進行互動'}。來源於 ${selectedNode.data.dockerInfo.sourceFile} 檔案。`;
    }
    isDockerSummary = true;
  } else {
    // 檔案節點的摘要 - 優先顯示 Docker 分析摘要
    const dockerKey = `github:${selectedNode.id}`;
    if (dockerAnalysis[dockerKey]?.hasDockerIntegration) {
      summary = dockerAnalysis[dockerKey].summary;
      isDockerSummary = true;
    } else {
      // 嘗試不同的鍵格式來查找一般摘要
      const possibleKeys = [
        selectedNode.id,
        `github:${selectedNode.id}`,
        selectedNode.data.fullPath,
        selectedNode.data.sourceFile
      ].filter(Boolean);

      for (const key of possibleKeys) {
        if (summaries[key]) {
          summary = summaries[key];
          break;
        }
      }
    }
  }

  if (!summary) return null;

  return (
    <div className="bg-green-50 p-4 rounded-lg">
      <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
        📋 {isDockerSummary ? 'Docker 整合摘要' : '檔案摘要'}
        {isDockerSummary && <span className="text-blue-600">🐳</span>}
      </h4>
      <div className="text-sm text-gray-700 leading-relaxed">
        <p className="whitespace-pre-wrap">{summary}</p>
      </div>
    </div>
  );
});

NodeSummary.displayName = 'NodeSummary';

// 節點依賴統計組件
const NodeDependencies = React.memo(({ 
  dependencies 
}: {
  dependencies: { incoming: number; outgoing: number };
}) => (
  <div className="bg-blue-50 p-4 rounded-lg">
    <h4 className="font-medium text-gray-900 mb-2">依賴關係</h4>
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div>
        <span className="text-gray-600">輸入依賴：</span>
        <span className="font-medium text-blue-600 ml-1">
          {dependencies.incoming}
        </span>
      </div>
      <div>
        <span className="text-gray-600">輸出依賴：</span>
        <span className="font-medium text-green-600 ml-1">
          {dependencies.outgoing}
        </span>
      </div>
    </div>
  </div>
));

NodeDependencies.displayName = 'NodeDependencies';



// Docker 分析組件
const NodeDockerAnalysis = React.memo(({ 
  selectedNode,
  dockerAnalysis
}: {
  selectedNode: Node;
  dockerAnalysis: Record<string, DockerAnalysisResult>;
}) => {
  const cacheKey = `github:${selectedNode.id}`;
  const analysis = dockerAnalysis[cacheKey];

  if (!analysis) return null;

  return (
    <div className="bg-blue-50 p-4 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-gray-900">🐳 Docker 整合分析</h4>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-xs rounded ${
            analysis.hasDockerIntegration
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {analysis.hasDockerIntegration ? '✅ 有 Docker' : '❌ 無 Docker'}
          </span>
        </div>
      </div>
      
      <div className="text-sm text-gray-700 leading-relaxed">
        {analysis.hasDockerIntegration ? (
          <div className="space-y-3">
            {/* Docker 工具 */}
            {analysis.dockerTools.length > 0 && (
              <div>
                <h5 className="font-medium text-gray-800 mb-2">🛠️ 使用的 Docker 工具：</h5>
                <div className="flex flex-wrap gap-1">
                  {analysis.dockerTools.map((tool: string, index: number) => (
                    <span key={index} className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Docker APIs */}
            {analysis.dockerApis.length > 0 && (
              <div>
                <h5 className="font-medium text-gray-800 mb-2">🔌 Docker API 詳情：</h5>
                <div className="space-y-2">
                  {analysis.dockerApis.map((api: DockerAPI, index: number) => (
                    <div key={index} className="bg-white p-3 rounded border border-blue-200">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded font-medium">
                          {api.apiType}
                        </span>
                        {api.line && (
                          <span className="text-xs text-gray-500">行號: {api.line}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 mb-2">{api.description}</p>
                      {api.codeSnippet && (
                        <pre className="text-xs bg-gray-100 p-2 rounded overflow-x-auto text-gray-800">
                          {api.codeSnippet}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Docker 摘要 */}
            <div>
              <h5 className="font-medium text-gray-800 mb-2">📋 Docker 整合摘要：</h5>
              <div className="bg-white p-3 rounded border border-blue-200">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {analysis.summary}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-gray-600 italic">
            此檔案未檢測到 Docker API 或相關技術的使用。
          </div>
        )}
      </div>
    </div>
  );
});

NodeDockerAnalysis.displayName = 'NodeDockerAnalysis';

// 相關檔案組件
const NodeRelatedFiles = React.memo(({ 
  relatedFiles,
  nodes,
  onSelectNode
}: {
  relatedFiles: Array<{ relatedId: string; isOutgoing: boolean; uniqueKey: string }>;
  nodes: Node[];
  onSelectNode: (node: Node) => void;
}) => (
  <div>
    <h4 className="font-semibold text-gray-900 mb-3">相關檔案</h4>
    <div className="space-y-2">
      {relatedFiles.map(({ relatedId, isOutgoing, uniqueKey }) => (
        <div 
          key={uniqueKey}
          className="flex items-center gap-3 p-3 bg-gray-100 border border-gray-200 rounded-lg text-sm cursor-pointer hover:bg-gray-200 hover:border-gray-300 transition-all duration-200"
          onClick={() => {
            const relatedNode = nodes.find(n => n.id === relatedId);
            if (relatedNode) {
              onSelectNode(relatedNode);
            }
          }}
        >
          <span className={`font-bold text-lg ${isOutgoing ? "text-green-600" : "text-blue-600"}`}>
            {isOutgoing ? "→" : "←"}
          </span>
          <span className="truncate font-medium text-gray-800">{relatedId.split('/').pop()}</span>
        </div>
      ))}
    </div>
  </div>
));

NodeRelatedFiles.displayName = 'NodeRelatedFiles';

export default App;
